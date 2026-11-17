"""Render the FMOD backing audio for Hear Say scenes to browser M4A files.

Usage: python scripts/render-hearsay-audio.py <game-root> <scene-json> <output-dir> <ffmpeg.exe>
Requires the user's local Party Pack 11 installation and its FMOD 2.3.6 DLLs.
"""

import ctypes as C
import json
import os
import subprocess
import sys
from pathlib import Path

game_root = Path(sys.argv[1])
scenes = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
output_dir = Path(sys.argv[3])
ffmpeg = Path(sys.argv[4])
output_dir.mkdir(parents=True, exist_ok=True)
os.add_dll_directory(str(game_root))
studio = C.WinDLL(str(game_root / "fmodstudio.dll"))
core = C.WinDLL(str(game_root / "fmod.dll"))
pointer = C.c_void_p


def method(dll, name, args):
    function = getattr(dll, name)
    function.argtypes = args
    function.restype = C.c_int
    return function


create = method(studio, "FMOD_Studio_System_Create", [C.POINTER(pointer), C.c_uint])
get_core = method(studio, "FMOD_Studio_System_GetCoreSystem", [pointer, C.POINTER(pointer)])
set_output = method(core, "FMOD_System_SetOutput", [pointer, C.c_int])
initialize = method(
    studio, "FMOD_Studio_System_Initialize", [pointer, C.c_int, C.c_uint, C.c_uint, pointer]
)
load_bank = method(
    studio, "FMOD_Studio_System_LoadBankFile", [pointer, C.c_char_p, C.c_uint, C.POINTER(pointer)]
)
get_event = method(
    studio, "FMOD_Studio_System_GetEvent", [pointer, C.c_char_p, C.POINTER(pointer)]
)
create_instance = method(
    studio, "FMOD_Studio_EventDescription_CreateInstance", [pointer, C.POINTER(pointer)]
)
start = method(studio, "FMOD_Studio_EventInstance_Start", [pointer])
get_state = method(
    studio, "FMOD_Studio_EventInstance_GetPlaybackState", [pointer, C.POINTER(C.c_int)]
)
update = method(studio, "FMOD_Studio_System_Update", [pointer])
release = method(studio, "FMOD_Studio_System_Release", [pointer])


def check(result, label):
    if result != 0:
        raise RuntimeError(f"{label}: FMOD error {result}")


unique_scenes = {scene["video"]: scene for scene in scenes}
for index, scene in enumerate(unique_scenes.values(), 1):
    output = output_dir / (Path(scene["video"]).stem + ".m4a")
    if output.exists() and output.stat().st_size > 0:
        continue
    wav = output.with_suffix(".wav")
    system = pointer()
    check(create(C.byref(system), 0x00020306), "create system")
    try:
        core_system = pointer()
        check(get_core(system, C.byref(core_system)), "get core")
        check(set_output(core_system, 5), "set WAV writer output")
        wav_path = C.create_string_buffer(str(wav.resolve()).encode())
        check(initialize(system, 256, 4, 1, C.cast(wav_path, pointer)), "initialize")
        for bank_name in ("Host.strings.bank", "Host.bank", "SFX.bank", "Music.bank"):
            bank = pointer()
            path = game_root / "games" / "MicGame" / bank_name
            check(load_bank(system, str(path).encode(), 0, C.byref(bank)), f"load {bank_name}")
        description = pointer()
        check(
            get_event(system, ("event:/" + scene["backingTrack"]).encode(), C.byref(description)),
            "get event",
        )
        instance = pointer()
        check(create_instance(description, C.byref(instance)), "create instance")
        check(start(instance), "start event")
        for _ in range(6000):
            check(update(system), "update")
            state = C.c_int()
            if get_state(instance, C.byref(state)) == 0 and state.value == 2:
                break
        else:
            raise RuntimeError(f"Event did not finish: {scene['backingTrack']}")
    finally:
        check(release(system), "release system")
    subprocess.run(
        [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "aac", "-b:a", "128k", str(output)],
        check=True,
    )
    wav.unlink()
    print(f"{index}/{len(unique_scenes)} {output.name}", flush=True)
