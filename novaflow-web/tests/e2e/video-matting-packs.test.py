"""Frame transport must preserve exact pixels and reject partial/corrupt input."""
import contextlib
import importlib.util
import io
from pathlib import Path
import struct
import tempfile
import unittest
from PIL import Image

script = Path(__file__).resolve().parents[2] / 'worker/src/matting/matting-runner.py'
spec = importlib.util.spec_from_file_location('matting_runner', script)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class FramePackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        buffer = io.BytesIO()
        Image.new('RGB', (16, 16), (12, 130, 230)).save(buffer, format='PNG')
        self.png = buffer.getvalue()

    def pack(self, index, data=None):
        data = self.png if data is None else data
        return struct.pack('<II', index, len(data)) + data

    def unpack(self, packs, count=2):
        paths = []
        for i, data in enumerate(packs):
            path = self.root / ('pack%d.bin' % i)
            path.write_bytes(data)
            paths.append(path)
        with contextlib.redirect_stdout(io.StringIO()):
            return runner.unpack_frames(paths, str(self.root / 'frames'), 16, 16, count)

    def test_multiple_packs_preserve_original_png(self):
        names = self.unpack([self.pack(0), self.pack(1)])
        self.assertEqual(len(names), 2)
        for name in names:
            self.assertEqual((self.root / 'frames' / name).read_bytes(), self.png)

    def test_reject_partial_duplicate_missing_or_extra_frames(self):
        for data in [self.pack(0) + self.pack(0), self.pack(0) + self.pack(2),
                     self.pack(0), self.pack(0) + self.pack(1)[:-1],
                     self.pack(0) + self.pack(1) + b'bad', self.pack(0, b'not png')]:
            with self.subTest(data=data[:8]), self.assertRaises(SystemExit):
                self.unpack([data])

    def test_reject_wrong_dimensions(self):
        buffer = io.BytesIO()
        Image.new('RGB', (32, 16)).save(buffer, format='PNG')
        with self.assertRaises(SystemExit):
            self.unpack([self.pack(0, buffer.getvalue())], 1)


if __name__ == '__main__':
    unittest.main()
