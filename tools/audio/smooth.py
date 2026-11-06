"""
Toglie al loop dello scivolamento la pulsazione ritmica (modulazione d'ampiezza tra 1 e 20 Hz,
circa 3 e 5,6 Hz nel loop fornito), che insieme alla grana bassa lo faceva sembrare un motore.
La grana del rumore resta; il volume medio non cambia. Lo smoothing è circolare: il loop resta senza giunture.

    python3 tools/audio/smooth.py assets/audio/slide-loop-2mps-48k.wav assets/audio/slide-loop-2mps-48k-smooth.wav
"""
import sys
import numpy as np, wave
from scipy.signal import butter, sosfilt, sosfilt_zi
def load(p):
    w=wave.open(p); n=w.getnframes(); sr=w.getframerate()
    return np.frombuffer(w.readframes(n),dtype='<i2').astype(float)/32768, sr
def save(p,a,sr):
    a=np.clip(a,-1,1); w=wave.open(p,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((a*32767).astype('<i2').tobytes()); w.close()
def smooth(x,n):
    k=np.ones(n)/n; return np.convolve(np.pad(x,(n,n),mode='wrap'),k,mode='same')[n:-n]
def flatten(a,sr,amount=1.0):
    """Riduce la modulazione d'ampiezza ritmica (1–20 Hz) mantenendo la grana del rumore."""
    env=np.sqrt(smooth(a*a,int(0.05*sr)))          # inviluppo veloce (50 ms)
    slow=np.sqrt(smooth(a*a,int(1.5*sr)))          # inviluppo lento (1,5 s)
    ratio=np.maximum(env,1e-4)/np.maximum(slow,1e-4)
    out=a/ratio**amount
    return out*np.sqrt(np.mean(a*a)/np.mean(out*out))
def amstrength(a,sr):
    env=np.abs(a); hop=sr//200; e=np.array([env[i:i+hop].mean() for i in range(0,len(env)-hop,hop)])
    return round(np.std(e)/np.mean(e),3)

if __name__ == "__main__":
    a, sr = load(sys.argv[1])
    save(sys.argv[2], flatten(a, sr), sr)
