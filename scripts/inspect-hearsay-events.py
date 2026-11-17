"""Read Hear Say FMOD event lengths and timeline markers from a local installation.

Usage: python scripts/inspect-hearsay-events.py <game-root> <scene-json> <output-json>
The game-root is the folder containing fmodstudio.dll and games/MicGame.
"""

import ctypes as C
import json
import os
import sys
import time
from pathlib import Path

game_root = Path(sys.argv[1])
scenes = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
output = Path(sys.argv[3])
os.add_dll_directory(str(game_root))
studio = C.WinDLL(str(game_root / "fmodstudio.dll"))
pointer = C.c_void_p


def method(name, args):
    function = getattr(studio, name)
    function.argtypes = args
    function.restype = C.c_int
    return function


create = method("FMOD_Studio_System_Create", [C.POINTER(pointer), C.c_uint])
initialize = method(
    "FMOD_Studio_System_Initialize", [pointer, C.c_int, C.c_uint, C.c_uint, pointer]
)
load_bank = method(
    "FMOD_Studio_System_LoadBankFile",
    [pointer, C.c_char_p, C.c_uint, C.POINTER(pointer)],
)
get_event = method(
    "FMOD_Studio_System_GetEvent", [pointer, C.c_char_p, C.POINTER(pointer)]
)
get_length = method(
    "FMOD_Studio_EventDescription_GetLength", [pointer, C.POINTER(C.c_int)]
)
create_instance = method(
    "FMOD_Studio_EventDescription_CreateInstance", [pointer, C.POINTER(pointer)]
)
set_callback = method(
    "FMOD_Studio_EventInstance_SetCallback", [pointer, pointer, C.c_uint]
)
get_position = method(
    "FMOD_Studio_EventInstance_GetTimelinePosition", [pointer, C.POINTER(C.c_int)]
)
start = method("FMOD_Studio_EventInstance_Start", [pointer])
update = method("FMOD_Studio_System_Update", [pointer])
release_instance = method("FMOD_Studio_EventInstance_Release", [pointer])
get_bus = method("FMOD_Studio_System_GetBus", [pointer, C.c_char_p, C.POINTER(pointer)])
set_volume = method("FMOD_Studio_Bus_SetVolume", [pointer, C.c_float])
release = method("FMOD_Studio_System_Release", [pointer])


class Marker(C.Structure):
    _fields_ = [("name", C.c_char_p), ("position", C.c_int)]


class ProgrammerSound(C.Structure):
    _fields_ = [("name", C.c_char_p), ("sound", pointer), ("subsound_index", C.c_int)]


callback_type = C.WINFUNCTYPE(C.c_int, C.c_uint, pointer, pointer)
paths_by_instance = {}
timelines = {}
slot_count_by_path = {scene["backingTrack"]: len(scene["slots"]) for scene in scenes}


def on_marker(kind, instance, properties):
    path = paths_by_instance.get(instance)
    if not path:
        return 0
    if kind == 0x00000800:
        marker = C.cast(properties, C.POINTER(Marker)).contents
        timelines[path]["markers"].append(
            {"name": marker.name.decode("utf-8"), "positionMs": marker.position}
        )
    elif kind == 0x00000080:
        sound = C.cast(properties, C.POINTER(ProgrammerSound)).contents
        position = C.c_int()
        if get_position(instance, C.byref(position)) == 0:
            name = sound.name.decode("utf-8") if sound.name else ""
            if not name and slot_count_by_path[path] == 1:
                name = "Prompt0"
            timelines[path]["soundStarts"].append(
                {"name": name, "positionMs": position.value}
            )
    return 0


callback = callback_type(on_marker)

system = pointer()
if create(C.byref(system), 0x00020306) != 0:
    raise RuntimeError("The local FMOD version is not 2.3.6")
if initialize(system, 256, 0, 0, None) != 0:
    raise RuntimeError("Could not initialize FMOD")
try:
    bank_root = game_root / "games" / "MicGame"
    for bank_name in ("Host.strings.bank", "Host.bank", "SFX.bank", "Music.bank"):
        bank = pointer()
        result = load_bank(system, str(bank_root / bank_name).encode(), 0, C.byref(bank))
        if result != 0:
            raise RuntimeError(f"Could not load {bank_name}: FMOD error {result}")
    bus = pointer()
    if get_bus(system, b"bus:/", C.byref(bus)) == 0:
        set_volume(bus, 0.0)
    instances = []
    max_length = 0
    for path in sorted({scene["backingTrack"] for scene in scenes}):
        description = pointer()
        result = get_event(system, ("event:/" + path).encode(), C.byref(description))
        if result != 0:
            raise RuntimeError(f"Could not find {path}: FMOD error {result}")
        length = C.c_int()
        result = get_length(description, C.byref(length))
        if result != 0:
            raise RuntimeError(f"Could not read {path}: FMOD error {result}")
        timelines[path] = {"durationMs": length.value, "markers": [], "soundStarts": []}
        max_length = max(max_length, length.value)
        instance = pointer()
        if create_instance(description, C.byref(instance)) != 0:
            raise RuntimeError(f"Could not create {path}")
        paths_by_instance[instance.value] = path
        if set_callback(instance, callback, 0x00000880) != 0 or start(instance) != 0:
            raise RuntimeError(f"Could not start {path}")
        instances.append(instance)
    deadline = time.monotonic() + max_length / 1000 + 0.4
    while time.monotonic() < deadline:
        update(system)
        time.sleep(0.02)
    for instance in instances:
        release_instance(instance)
    output.write_text(json.dumps(timelines, indent=2) + "\n", encoding="utf-8")
    print(f"Read {len(timelines)} event timelines, {sum(len(item['markers']) for item in timelines.values())} markers, and {sum(len(item['soundStarts']) for item in timelines.values())} sound starts")
finally:
    release(system)
