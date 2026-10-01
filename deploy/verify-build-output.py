"""Parent-side bounded promotion from an isolated builder's /scratch/dist.

Call only after the target build and its children have exited. The builder's
remaining process must be the trusted keepalive, not application code.
"""
import os
import re
import stat
import sys

pid, destination = sys.argv[1:]
if not pid.isdecimal() or int(pid) <= 1:
    raise ValueError("invalid builder PID")
destination = os.path.abspath(destination)
if not re.fullmatch(r"/home/azureuser/forestguard-releases/fg1-stage-[0-9-]+/wildfire-dashboard/dist", destination):
    raise ValueError("destination must be the new staging dashboard")

flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

def directory(parent, name):
    if name in ("", ".", "..") or "/" in name:
        raise ValueError("invalid path component")
    return os.open(name, flags, dir_fd=parent)

static = {"index.html", "favicon.svg", "icons.svg", "firmware/index.html",
          "firmware/installer.css", "firmware/manifest.json",
          "firmware/node-bootloader.bin", "firmware/node-partitions.bin",
          "firmware/node-boot-app.bin", "firmware/node-app.bin"}
asset = re.compile(r"assets/[A-Za-z0-9._-]+\.(?:js|css|svg|png|woff2)")
limits = {"files": 0, "bytes": 0}

def promote(source, target, prefix=""):
    for name in sorted(os.listdir(source)):
        relative = prefix + name
        info = os.stat(name, dir_fd=source, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            if relative not in ("assets", "firmware"):
                raise ValueError("unexpected output directory")
            child = directory(source, name)
            os.mkdir(name, 0o755, dir_fd=target)
            output = directory(target, name)
            try:
                promote(child, output, relative + "/")
            finally:
                os.close(child)
                os.close(output)
            continue
        if relative not in static and not asset.fullmatch(relative):
            raise ValueError("unexpected output file")
        leaf = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=source)
        try:
            before = os.fstat(leaf)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 4 * 1024 * 1024:
                raise ValueError("unsafe output file")
            limits["files"] += 1
            limits["bytes"] += before.st_size
            if limits["files"] > 128 or limits["bytes"] > 20 * 1024 * 1024:
                raise ValueError("build output exceeds limits")
            out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644, dir_fd=target)
            try:
                out_info = os.fstat(out)
                if not stat.S_ISREG(out_info.st_mode) or out_info.st_nlink != 1:
                    raise ValueError("unsafe destination file")
                remaining = before.st_size
                while remaining:
                    data = os.read(leaf, min(65536, remaining))
                    if not data:
                        raise ValueError("output changed during copy")
                    view = memoryview(data)
                    while view:
                        written = os.write(out, view)
                        if written <= 0:
                            raise ValueError("incomplete output write")
                        view = view[written:]
                    remaining -= len(data)
                after = os.fstat(leaf)
                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or after.st_nlink != 1:
                    raise ValueError("output changed during copy")
            finally:
                os.close(out)
        finally:
            os.close(leaf)

root = os.open(f"/proc/{pid}/root", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
scratch = directory(root, "scratch")
source = directory(scratch, "dist")
target = os.open("/", flags)
try:
    for component in destination.strip("/").split("/")[:-1]:
        child = directory(target, component)
        os.close(target)
        target = child
    os.mkdir("dist", 0o755, dir_fd=target)
    child = directory(target, "dist")
    os.close(target)
    target = child
    promote(source, target)
    firmware = directory(source, "firmware")
    try:
        present = set(os.listdir(source)) | {"firmware/" + name for name in os.listdir(firmware)}
        if not static.issubset(present):
            raise ValueError("required build output is missing")
    finally:
        os.close(firmware)
    print(f"Verified {limits['files']} static files, {limits['bytes']} bytes")
finally:
    for descriptor in (root, scratch, source, target):
        os.close(descriptor)
