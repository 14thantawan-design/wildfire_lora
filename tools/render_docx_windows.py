"""Render DOCX with installed Microsoft Word and the bundled Codex rasterizer.

Windows fallback for runtimes whose libreOfficeVersion is null. The managed
render_docx.py is imported unchanged; only its DOCX-to-PDF conversion is adapted.
No LibreOffice installation, PATH changes, uploads, or source DOCX edits occur.
Run using the Python executable returned by load_workspace_dependencies.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from xml.etree import ElementTree as ET
from zipfile import ZipFile


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_docx(path: Path) -> None:
    """Reject active-content and externally loaded dependencies, not hyperlinks."""
    if path.suffix.lower() != '.docx':
        raise ValueError('Only macro-free .docx files are supported.')
    with ZipFile(path) as package:
        names = package.namelist()
        if 'word/document.xml' not in names:
            raise ValueError('This is not a Word DOCX package.')
        for name in names:
            if name.lower().endswith('vbaproject.bin'):
                raise ValueError('Macro content is not supported.')
            if not name.endswith('.rels'):
                continue
            for relationship in ET.fromstring(package.read(name)):
                if relationship.get('TargetMode') == 'External':
                    kind = relationship.get('Type', '').rsplit('/', 1)[-1]
                    if kind != 'hyperlink':
                        raise ValueError(f'External {kind} dependency requires manual review.')


def make_word_converter(powershell: Path, adapter: Path, timeout: int):
    def convert_to_pdf(doc_path, user_profile, out_dir, stem, verbose=False):
        del user_profile
        pdf_path = Path(out_dir) / f'{stem}.pdf'
        command = [
            str(powershell), '-NoLogo', '-NoProfile', '-NonInteractive',
            '-File', str(adapter), '-InputPath', str(doc_path),
            '-OutputPath', str(pdf_path),
        ]
        print('Converting a read-only temporary copy with Microsoft Word...', flush=True)
        try:
            result = subprocess.run(
                command, capture_output=True, text=True, encoding='utf-8',
                errors='replace', timeout=timeout,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                'Word conversion timed out. No original document was opened. '
                'Check for a hidden Word prompt before retrying; this tool does '
                'not force-kill Word sessions.'
            ) from error
        log = '\n'.join(part for part in (result.stdout, result.stderr) if part)
        if verbose or result.returncode:
            print(log, flush=True)
        if result.returncode or not pdf_path.is_file() or not pdf_path.stat().st_size:
            raise RuntimeError(f'Microsoft Word export failed:\n{log}')
        return str(pdf_path), log
    return convert_to_pdf


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_path', type=Path)
    parser.add_argument('--output_dir', type=Path, required=True)
    parser.add_argument('--renderer', type=Path, required=True,
                        help='Absolute path to the packaged documents/render_docx.py.')
    parser.add_argument('--dpi', type=int, default=140)
    parser.add_argument('--emit_pdf', action='store_true')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--timeout', type=int, default=180,
                        help='Timeout in seconds for Word conversion.')
    args = parser.parse_args()
    if sys.platform != 'win32':
        parser.error('This fallback is for Windows only.')
    if not 36 <= args.dpi <= 300 or args.timeout < 1:
        parser.error('DPI must be 36–300 and timeout must be positive.')

    source = args.input_path.resolve(strict=True)
    output = args.output_dir.resolve()
    renderer_path = args.renderer.resolve(strict=True)
    dependencies = Path(sys.executable).resolve().parent.parent
    if dependencies.name != 'dependencies' or dependencies.parent.name != 'codex-primary-runtime':
        parser.error('Run with the Codex bundled Python returned by load_workspace_dependencies.')
    powershell = dependencies / 'native/powershell/pwsh.exe'
    poppler = dependencies / 'native/poppler/Library/bin'
    adapter = Path(__file__).with_name('export_word_pdf.ps1')
    for required in (powershell, poppler / 'pdfinfo.exe', poppler / 'pdftoppm.exe', adapter):
        if not required.is_file():
            parser.error(f'Missing dependency: {required}')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error('Output directory must be new or empty; existing outputs are not overwritten.')
    validate_docx(source)
    before = sha256(source)
    output.mkdir(parents=True, exist_ok=True)

    spec = importlib.util.spec_from_file_location('codex_packaged_docx_renderer', renderer_path)
    if spec is None or spec.loader is None:
        raise RuntimeError('Cannot load the packaged DOCX renderer.')
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    renderer.convert_to_pdf = make_word_converter(powershell, adapter, args.timeout)

    # Keep the packaged rasterizer and point it explicitly to bundled Poppler.
    bundled_convert = renderer.convert_from_path

    def convert_with_bundled_poppler(*positional, **keyword):
        keyword['poppler_path'] = str(poppler)
        keyword['thread_count'] = 4
        return bundled_convert(*positional, **keyword)

    renderer.convert_from_path = convert_with_bundled_poppler
    try:
        with tempfile.TemporaryDirectory(prefix='word-render-') as temporary:
            copy = Path(temporary) / source.name
            shutil.copyfile(source, copy)
            pages = renderer.rasterize(
                str(copy), str(output), args.dpi, args.verbose, args.emit_pdf,
            )
    finally:
        if sha256(source) != before:
            raise RuntimeError('Source DOCX changed during conversion; inspect before proceeding.')
    if not pages:
        raise RuntimeError('The renderer produced no pages.')

    summary = {
        'engine': 'Microsoft Word + packaged Codex renderer + bundled Poppler',
        'source': str(source), 'source_sha256': before,
        'source_unchanged': True, 'page_count': len(pages),
        'dpi': args.dpi, 'output_dir': str(output),
        'packaged_renderer': str(renderer_path),
    }
    (output / 'render-summary.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8',
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
