#!/usr/bin/env python3
"""Print Swift field and enum-case names from a Mach-O's __swift5_reflstr section around matches of a regex.

The names of one type's fields are stored next to each other, so the neighbours of a match read like
that type's field list. This is how Arc's auto-archive structure was mapped without a decompiler.

usage: python3 -I tools/swift-reflstr.py <thin-mach-o> <regex> [context=6]
       (run `lipo -thin arm64 <universal> -output <thin>` first for universal binaries)
"""
import re
import subprocess
import sys

SECTION_PATTERN = re.compile(
    r"sectname __swift5_reflstr\n\s+segname \S+\n\s+addr 0x[0-9a-f]+\n\s+size (0x[0-9a-f]+)\n\s+offset (\d+)"
)


def read_reflection_names(binary_path):
    load_commands = subprocess.run(["otool", "-l", binary_path], capture_output=True, text=True, check=True).stdout
    section = SECTION_PATTERN.search(load_commands)
    if section is None:
        sys.exit("No __swift5_reflstr section. Is this a thin Mach-O that contains Swift code?")
    section_size = int(section.group(1), 16)
    section_offset = int(section.group(2))
    with open(binary_path, "rb") as binary_file:
        binary_file.seek(section_offset)
        section_bytes = binary_file.read(section_size)
    return [name.decode("utf-8", "replace") for name in section_bytes.split(b"\0")]


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    binary_path = sys.argv[1]
    pattern = re.compile(sys.argv[2])
    context = int(sys.argv[3]) if len(sys.argv) > 3 else 6

    names = read_reflection_names(binary_path)
    print(f"{len(names)} names in __swift5_reflstr")
    last_printed_index = -context - 1
    for index, name in enumerate(names):
        # Skip matches already shown inside the previous window.
        if not pattern.search(name) or index - last_printed_index <= context:
            continue
        last_printed_index = index
        window = [neighbour for neighbour in names[max(0, index - context): index + context + 1] if neighbour]
        print(f"[{index}] " + " | ".join(window))


if __name__ == "__main__":
    main()
