"""Safety and failure-path tests; these do not launch Microsoft Word."""

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from render_docx_windows import make_word_converter, sha256, validate_docx


class InputValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='render-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def package(self, relation=None, macro=False, document=True):
        path = self.root / 'input.docx'
        with ZipFile(path, 'w') as archive:
            if document:
                archive.writestr('word/document.xml', '<document/>')
            if macro:
                archive.writestr('word/vbaProject.bin', b'test-only')
            if relation:
                archive.writestr('word/_rels/document.xml.rels',
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    f'<Relationship Id="r1" Type="https://example.invalid/{relation}" '
                    'TargetMode="External" Target="https://example.invalid/target"/>'
                    '</Relationships>')
        return path

    def test_macro_free_document_is_accepted_and_unchanged(self):
        path = self.package()
        before = sha256(path)
        validate_docx(path)
        self.assertEqual(sha256(path), before)

    def test_hyperlink_is_accepted_without_fetching_it(self):
        validate_docx(self.package(relation='hyperlink'))

    def test_external_template_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'attachedTemplate'):
            validate_docx(self.package(relation='attachedTemplate'))

    def test_external_image_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'image'):
            validate_docx(self.package(relation='image'))

    def test_macro_content_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Macro content'):
            validate_docx(self.package(macro=True))

    def test_missing_document_part_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not a Word DOCX'):
            validate_docx(self.package(document=False))

    def test_docm_extension_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'macro-free'):
            validate_docx(self.root / 'input.docm')

    def test_source_hash_detects_changed_content(self):
        path = self.root / 'bytes.txt'
        path.write_bytes(b'before')
        before = sha256(path)
        path.write_bytes(b'after')
        self.assertNotEqual(sha256(path), before)


class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='converter-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.convert = make_word_converter(Path('pwsh.exe'), Path('adapter.ps1'), 15)

    @patch('render_docx_windows.subprocess.run')
    def test_success_returns_generated_pdf(self, run):
        (self.root / 'sample.pdf').write_bytes(b'%PDF-test')
        run.return_value = subprocess.CompletedProcess([], 0, 'ok', '')
        result, log = self.convert('copy.docx', '', str(self.root), 'sample')
        self.assertEqual(Path(result), self.root / 'sample.pdf')
        self.assertEqual(log, 'ok')
        command = run.call_args.args[0]
        self.assertIn('-NonInteractive', command)
        self.assertIn('-InputPath', command)
        self.assertNotIn('shell', run.call_args.kwargs)
        self.assertEqual(run.call_args.kwargs['timeout'], 15)

    @patch('render_docx_windows.subprocess.run')
    def test_failed_export_is_not_reported_as_success(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, '', 'export error')
        with self.assertRaisesRegex(RuntimeError, 'export error'):
            self.convert('copy.docx', '', str(self.root), 'sample')

    @patch('render_docx_windows.subprocess.run')
    def test_missing_pdf_is_rejected_even_with_exit_zero(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '', '')
        with self.assertRaisesRegex(RuntimeError, 'export failed'):
            self.convert('copy.docx', '', str(self.root), 'sample')

    @patch('render_docx_windows.subprocess.run')
    def test_timeout_reports_failure_without_killing_word(self, run):
        run.side_effect = subprocess.TimeoutExpired(['pwsh.exe'], 15)
        with self.assertRaisesRegex(RuntimeError, 'does not force-kill'):
            self.convert('copy.docx', '', str(self.root), 'sample')


if __name__ == '__main__':
    unittest.main()
