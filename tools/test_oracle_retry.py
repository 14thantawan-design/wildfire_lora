import unittest
from datetime import datetime, timezone
from types import SimpleNamespace as Obj
import oci
from oracle_retry import decide, is_transient_error

NOW = 10000


def job(state='FAILED', age=2000, operation='APPLY'):
    return Obj(id='job', operation=operation, lifecycle_state=state,
               time_created=datetime.fromtimestamp(NOW - age, timezone.utc))


def capacity(_):
    return [Obj(level='ERROR', message='Error: 500-InternalError, Out of host capacity.')]


class RetryTests(unittest.TestCase):
    def test_capacity_can_retry(self):
        self.assertEqual(decide([job()], capacity, NOW), 'RETRY')

    def test_waits_between_attempts(self):
        self.assertEqual(decide([job(age=60)], capacity, NOW), 'COOLDOWN')

    def test_success_never_recreates(self):
        self.assertEqual(decide([job('SUCCEEDED'), job()], capacity, NOW), 'SUCCEEDED')

    def test_active_jobs_prevent_overlap(self):
        for status in ('ACCEPTED', 'IN_PROGRESS', 'CANCELING'):
            self.assertEqual(decide([job(status), job()], capacity, NOW), 'IN_PROGRESS')

    def test_unrelated_and_mixed_errors_stop(self):
        for messages in ([], ['Unauthorized'], ['Out of host capacity.', 'Quota exceeded']):
            logs = lambda _: [Obj(level='ERROR', message=m) for m in messages]
            self.assertEqual(decide([job()], logs, NOW), 'NEEDS_REVIEW')

    def test_cancellation_and_empty_history_stop(self):
        self.assertEqual(decide([job('CANCELED')], capacity, NOW), 'NEEDS_REVIEW')
        self.assertEqual(decide([], capacity, NOW), 'NEEDS_REVIEW')

    def test_temporary_connection_errors_retry_later(self):
        self.assertTrue(is_transient_error(oci.exceptions.ConnectTimeout()))
        self.assertTrue(is_transient_error(TimeoutError()))
        self.assertTrue(is_transient_error(oci.exceptions.ServiceError(
            status=503, code='Unavailable', headers={}, message='temporary')))

    def test_authentication_and_programming_errors_are_not_transient(self):
        self.assertFalse(is_transient_error(ValueError('bad configuration')))
        self.assertFalse(is_transient_error(oci.exceptions.ServiceError(
            status=401, code='Unauthorized', headers={}, message='bad key')))


if __name__ == '__main__':
    unittest.main()
