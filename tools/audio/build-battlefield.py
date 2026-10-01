"""Reproducible edits of CC0 recordings; downloads are kept in output/audio-sources.
Sources and licenses are in src/client/assets/audio/CREDITS.md.
"""
from pathlib import Path
import subprocess, json, shutil, struct, math
root=Path(__file__).resolve().parents[2]; source=root/'output/audio-sources'; target=root/'src/client/assets/audio';target.mkdir(parents=True,exist_ok=True)
manifest={}
def convert(key,file,start=0,duration=None,filters=''):
    args=['ffmpeg','-v','error','-y','-ss',str(start),'-i',str(file)]
    if duration:args+=['-t',str(duration)]
    af='highpass=f=65,lowpass=f=14000'+(','+filters if filters else '')+',loudnorm=I=-19:TP=-3:LRA=8'
    args+=['-af',af,'-ac','1','-ar','44100','-c:a','libvorbis','-q:a','4',str(target/(key+'.ogg'))]
    subprocess.run(args,check=True);manifest.setdefault(key.rsplit('-',1)[0],[]).append(key+'.ogg')
for family,starts in {'pistol':[.26,2.81,4.04], 'rifle':[.34,2.29,6.0], 'sniper':[.43,3.56,5.98], 'shotgun':[.14]}.items():
    filename={'pistol':'cz','rifle':'sks','sniper':'mosin','shotgun':'shotty'}[family]
    for i,start in enumerate(starts):convert(family+'-'+str(i),source/'gunshot-sounds/sounds'/ (filename+'.wav'),max(0,start-.018),1.1 if family=='sniper' else .65)
for prefix in ['footstep_grass','footstep_concrete','footstep_wood','footstep_snow','impactWood_heavy','impactMetal_heavy','impactGlass_heavy','impactSoft_heavy','impactMining']:
    files=sorted((source/'kenney/Audio').glob(prefix+'*.ogg'))[:4]
    for i,file in enumerate(files):convert(prefix+'-'+str(i),file)
for i,file in enumerate(sorted((source/'bangs').glob('cannon_*.ogg'))[:3]):convert('cannon-'+str(i),file)
for i,file in enumerate(sorted((source/'bangs').glob('bang_*.ogg'))[:3]):convert('explosion-'+str(i),file)
for key,file in [('reload','assaultriflereload1_0.wav'),('reloadPistol','gunreload1.wav'),('bolt','shotguncock_0.wav')]:convert(key+'-0',source/file)
# Cut a steady section and crossfade its ends. This avoids clicks when the buffer wraps.
def loop(key,file,seconds=4):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-ac','1','-ar','44100','-f','f32le','pipe:1']);a=list(struct.unpack('<%df'%(len(raw)//4),raw));rate=44100;n=min(len(a),int(seconds*rate));hop=rate//2
    start=max(range(0,max(1,len(a)-n),hop),key=lambda i:sum(v*v for v in a[i:i+n:100]));a=a[start:start+n];fade=int(.15*rate)
    tail=a[-fade:];head=a[:fade];mixed=[tail[i]*(1-i/fade)+head[i]*(i/fade) for i in range(fade)];a=a[fade:-fade]+mixed
    temp=source/(key+'.wav');subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(rate),'-ac','1','-i','pipe:0',str(temp)],input=struct.pack('<%df'%len(a),*a),check=True)
    convert(key+'-0',temp)
loop('engine',source/'engine_sound.mp3',3)
loop('rotor',source/'heli_0.ogg',4)
loop('wind',source/'wind-source.wav',12)
(target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len([x for v in manifest.values() for x in v]), 'samples',sum(p.stat().st_size for p in target.glob('*.ogg')),'bytes')
