"""One bounded Oracle Resource Manager attempt. Invoked by Windows Task Scheduler.

--inspect downloads configuration for review; --arm pins that reviewed configuration;
--run checks previous jobs and submits at most one apply. No background loop.
Credentials and state are outside the repository, under ~/.oci/forestguard-retry.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

import oci

ROOT = Path.home() / '.oci' / 'forestguard-retry'
CONFIG = Path.home() / '.oci' / 'config'
PROFILE = 'FORESTGUARD'
REGION = 'ap-singapore-1'
STACK_NAME = 'forest-server'
INTERVAL = 900


def save(path, value):
    temp = path.with_suffix('.new')
    temp.write_text(json.dumps(value, indent=2), encoding='utf-8')
    os.replace(temp, path)


def read_state():
    path = ROOT / 'state.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def emit(status, **details):
    print(json.dumps({'status': status, **details}, ensure_ascii=True))


def is_transient_error(exc):
    """Return true only for network/timeouts and retryable HTTP responses."""
    if isinstance(exc, (oci.exceptions.BaseRequestException,
                        oci.exceptions.RequestException, TimeoutError)):
        return True
    return isinstance(exc, oci.exceptions.ServiceError) and exc.status in {
        408, 429, 500, 502, 503, 504
    }


def fingerprint(config_bytes, variables):
    return hashlib.sha256(config_bytes + json.dumps(variables, sort_keys=True).encode()).hexdigest()


def decide(jobs, logs, now):
    """Fail closed on success, active work, cancellations, or unknown errors."""
    if any(j.operation == 'APPLY' and j.lifecycle_state == 'SUCCEEDED' for j in jobs):
        return 'SUCCEEDED'
    if any(j.lifecycle_state in ('ACCEPTED', 'IN_PROGRESS', 'CANCELING') for j in jobs):
        return 'IN_PROGRESS'
    applies = sorted((j for j in jobs if j.operation == 'APPLY'),
                     key=lambda j: j.time_created.timestamp(), reverse=True)
    if not applies:
        return 'NEEDS_REVIEW'
    latest = applies[0]
    if latest.lifecycle_state != 'FAILED':
        return 'NEEDS_REVIEW'
    errors = [str(j.message).lower() for j in logs(latest.id)
              if j.level in ('ERROR', 'FATAL')]
    if not errors or not all('out of host capacity' in e or 'out of capacity' in e for e in errors):
        return 'NEEDS_REVIEW'
    if now - latest.time_created.timestamp() < INTERVAL:
        return 'COOLDOWN'
    return 'RETRY'


def main(mode):
    ROOT.mkdir(parents=True, exist_ok=True)
    # Windows OS lock releases on process exit, including crashes.
    import msvcrt
    with (ROOT / 'run.lock').open('a+b') as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            emit('IN_PROGRESS', reason='Another local check holds the lock')
            return
        run(mode)


def run(mode):
    state = read_state()
    if mode == 'run' and state.get('stopped'):
        emit(state['stopped'])
        return
    if not CONFIG.exists():
        emit('SETUP_REQUIRED', reason='Oracle API config is not configured')
        return
    if mode == 'run' and not state.get('armed'):
        emit('SETUP_REQUIRED', reason='Inspect and review the saved stack before arming')
        return
    config = oci.config.from_file(str(CONFIG), PROFILE)
    if config['region'] != REGION:
        raise ValueError('Expected Singapore region')
    rm = oci.resource_manager.ResourceManagerClient(config, timeout=(10, 30),
                                                   retry_strategy=oci.retry.NoneRetryStrategy())
    stacks = oci.pagination.list_call_get_all_results(
        rm.list_stacks, compartment_id=config['tenancy'], display_name=STACK_NAME).data
    stacks = [s for s in stacks if s.display_name == STACK_NAME and s.lifecycle_state == 'ACTIVE']
    if len(stacks) != 1:
        raise ValueError('Expected exactly one active forest-server stack in root compartment')
    stack = rm.get_stack(stacks[0].id).data
    response = rm.get_stack_tf_config(stack.id)
    archive = response.data.content
    digest = fingerprint(archive, stack.variables)
    if mode == 'inspect':
        (ROOT / 'review-config.zip').write_bytes(archive)
        save(ROOT / 'review-variables.json', stack.variables)
        save(ROOT / 'review.json', {'stack_id': stack.id, 'digest': digest})
        emit('REVIEW_READY', stack=stack.display_name, directory=str(ROOT))
        return
    if mode == 'arm':
        review = json.loads((ROOT / 'review.json').read_text(encoding='utf-8'))
        if review != {'stack_id': stack.id, 'digest': digest}:
            raise ValueError('Configuration changed since inspection; review again')
        save(ROOT / 'state.json', {'armed': True, **review})
        emit('ARMED')
        return
    if state.get('stack_id') != stack.id or state.get('digest') != digest:
        state['stopped'] = 'CONFIG_CHANGED'
        save(ROOT / 'state.json', state)
        emit('CONFIG_CHANGED', reason='Review changed stack before any apply')
        return
    jobs = oci.pagination.list_call_get_all_results(rm.list_jobs, stack_id=stack.id).data
    now = time.time()
    decision = decide(jobs, lambda job: oci.pagination.list_call_get_all_results(
        rm.get_job_logs, job, level_greater_than_or_equal_to='ERROR').data, now)
    if decision in ('SUCCEEDED', 'NEEDS_REVIEW'):
        state['stopped'] = decision
        save(ROOT / 'state.json', state)
    if decision != 'RETRY':
        emit(decision)
        return
    # Resolve an uncertain POST by its durable unique display name, never by
    # submitting a new token after a timeout. Unknown outcomes need review.
    pending = state.get('pending')
    if pending:
        matches = [j for j in jobs if j.display_name == pending['name']]
        if not matches:
            state['stopped'] = 'UNCERTAIN_SUBMISSION'
            save(ROOT / 'state.json', state)
            emit('UNCERTAIN_SUBMISSION', reason='Check Oracle Jobs before resuming')
            return
        state.pop('pending')
    if now - state.get('last_submit', 0) < INTERVAL:
        emit('COOLDOWN')
        return
    token = str(uuid.uuid4())
    state['pending'] = {'name': 'forestguard-auto-' + token, 'token': token}
    state['last_submit'] = now
    save(ROOT / 'state.json', state)
    details = oci.resource_manager.models.CreateJobDetails(
        stack_id=stack.id, display_name=state['pending']['name'],
        job_operation_details=oci.resource_manager.models.CreateApplyJobOperationDetails(
            execution_plan_strategy='AUTO_APPROVED'))
    job = rm.create_job(details, opc_retry_token=token,
                        retry_strategy=oci.retry.NoneRetryStrategy()).data
    state['pending']['job_id'] = job.id
    save(ROOT / 'state.json', state)
    emit('SUBMITTED', job_id=job.id, state=job.lifecycle_state)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    for option in ('inspect', 'arm', 'run'):
        group.add_argument('--' + option, action='store_true')
    args = parser.parse_args()
    try:
        main(next(k for k, v in vars(args).items() if v))
    except Exception as exc:
        # Never print raw configs, signed requests, or exception bodies.
        if is_transient_error(exc):
            emit('TRANSIENT_ERROR', error_type=type(exc).__name__,
                 reason='Network or Oracle service was temporarily unavailable; retry later')
            raise SystemExit(0)
        emit('ERROR', error_type=type(exc).__name__,
             reason='Check authentication or Oracle service; do not submit another job blindly')
        raise SystemExit(1)
