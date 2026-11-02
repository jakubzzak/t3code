#!/usr/bin/env python3
"""Install three shared skill links; preserve replaced entries outside discovery roots."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

NAMES = ('shape', 'build', 'ship')
LEGACY = ('brainit', 'designit', 'specit', 'implit', 'fixit', 'testit', 'reviewit', 'finishit', 'composeit')

def install(home, source, retire=False):
    home, source = Path(home).expanduser(), Path(source).resolve()
    for name in NAMES:
        if not (source/name/'SKILL.md').is_file():
            raise ValueError('Missing skill: '+str(source/name))
    roots=[home/'.agents/skills',home/'.codex/skills',home/'.claude/skills']
    changes=[]
    for root in roots:
        for name in NAMES:
            dest=root/name;target=source/name
            if dest.is_symlink() and dest.resolve()==target:
                continue
            if dest.exists() and not dest.is_symlink():
                raise ValueError('Refusing to replace a real directory: '+str(dest))
            changes.append((dest,target))
        if retire:
            for name in LEGACY:
                dest=root/name
                if dest.exists() or dest.is_symlink():
                    changes.append((dest,None))
    if not changes:
        return {'changed':False,'message':'Already installed'}
    backup=home/'.agents/skill-backups'/('shape-build-ship-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True)
    manifest=[]
    # Append each completed step immediately; interrupted runs remain recoverable.
    for dest,target in changes:
        old=None
        if dest.exists() or dest.is_symlink():
            old=backup/dest.relative_to(home)
            old.parent.mkdir(parents=True,exist_ok=True)
            shutil.move(str(dest),str(old))
        row={'destination':str(dest),'backup':str(old) if old else None,'target':str(target) if target else None,'linked':False}
        manifest.append(row)
        (backup/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        if target:
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.symlink_to(target,target_is_directory=True)
            row['linked']=True
            (backup/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return {'changed':True,'backup':str(backup),'changes':manifest}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home',default=str(Path.home()))
    parser.add_argument('--retire-legacy',action='store_true')
    args=parser.parse_args()
    print(json.dumps(install(args.home,Path(__file__).resolve().parents[2],args.retire_legacy),indent=2))
