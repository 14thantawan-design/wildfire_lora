# ForestGuard Oracle retry setup

Prepared and connected 2026-09-06. API public-key fingerprint verified against the
user's configuration snippet; FORESTGUARD profile saved outside the repository.
Stack inspected live: single A1 Flex 1 OCPU / 6 GB instance, Ubuntu 24.04 image,
default boot volume, existing subnet and same SSH public key as the earlier apply.
No root-compartment instances, boot volumes or block volumes were present.
Configuration pinned with --arm. First live --run correctly returned COOLDOWN
because a recent manual capacity-failed job was less than 30 minutes old.
The forestguard-oracle Codex heartbeat is PAUSED. Windows Task Scheduler task
`ForestGuard-Oracle-Retry` now runs every 15 minutes, invoking
`tools/oracle-retry-task.ps1` and then Python directly. No AI calls are made.
Installed and tested on 2026-09-06: the real scheduled run returned COOLDOWN;
Windows accepted the test toast notification. Next initial run: 13:27 local time.

- Script: `tools/oracle_retry.py`, using the official OCI Python SDK.
- Python: `C:\Users\14tha\.oci\forestguard-venv\Scripts\python.exe`.
- API public key to upload: `C:\Users\14tha\.oci\forestguard-retry\api-public.pem`.
- Private key is local in the same protected directory. Never upload the private key.
- OCI configuration: `%USERPROFILE%\.oci\config`, profile `[FORESTGUARD]`.
- Region: `ap-singapore-1`; root compartment; exact stack name `forest-server`.

## Finish setup

1. Oracle profile > User settings > API Keys (or Tokens and keys) > Add API Key.
   Upload the public PEM file. Save the displayed configuration snippet to the
   FORESTGUARD profile, preserving any existing OCI profiles. Set key_file to the
   local api-private.pem path, region to ap-singapore-1. The snippet is identifiers,
   fingerprint and a path, not the private key contents.
2. Run `oracle_retry.py --inspect`. Review review-config.zip and review-variables.json
   in the protected directory. Confirm the existing stack creates only the intended
   A1 Flex 1 OCPU / 6 GB VM, ordinary Ubuntu boot volume, existing subnet, and the
   user's matching SSH public key. Check existing resources and free allocation.
   Do not arm a different plan or extra billable resources.
3. Run `oracle_retry.py --arm` only after that review. This pins the exact downloaded
   configuration and variables; changes stop future submissions.
4. Run `--run` once to validate real API behavior. Install/reinstall the Windows
   schedule with `tools/install-oracle-retry-task.ps1`. Keep the Codex heartbeat
   paused to avoid duplicate scheduling and AI usage.

The local computer must be awake with internet and the user logged into Windows.
Codex and the Oracle browser tab can be closed. Locking Windows is fine; signing
out prevents execution. Missed checks catch up after the computer is available.
Each check submits at most one job. Oracle executes accepted jobs independently.
No guaranteed time to obtain capacity. No queue or reservation is created by this tool.

## Behavior

Stops on any successful apply; waits for active jobs; retries only when ERROR logs
from the latest failed apply exclusively report capacity exhaustion. Other failures,
cancellations, configuration changes or uncertain submissions require review. It uses
a local OS lock, a durable request token and a 15-minute minimum submission interval.
An uncertain POST is never blindly resubmitted. State remains outside the repository.
No destroy or stack edits are performed. No raw credentials or logs are printed.

The Windows wrapper disables its scheduled task on success or unexpected status
and requests a Windows notification (popup fallback if the notification API fails).
Network timeouts, connection failures, HTTP 408/429, and temporary 5xx service
responses remain scheduled and retry on the next 15-minute interval.
Focus Assist/notification preferences can hide toasts. A persistent `notice.txt`
also records completion or problems. `last-check.json` and rotated `history.jsonl`
in `%USERPROFILE%\.oci\forestguard-retry` show status without opening Codex.
Pause with `Disable-ScheduledTask -TaskName ForestGuard-Oracle-Retry`.
Review a problem before enabling the task again. Do not re-arm after success
unless a new creation is explicitly intended.

## Verification

Six offline decision tests cover capacity retry, cooldown, success, active jobs,
unrelated/mixed errors, cancellations and empty history. SDK apply model serialization
checked locally. Live API authentication, stack/configuration reads, resource lists,
job history and ERROR logs verified. Cooldown path verified against real jobs.
Submitting through the script awaits the next eligible scheduled check; successful
instance creation remains dependent on Oracle capacity.

Official documentation:
- https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm
- https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/create-job-apply.htm
