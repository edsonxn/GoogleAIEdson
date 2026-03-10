import numpy as np
from scipy.io import wavfile

# Create 5s noise and 5s silence
rate = 24000
noise = np.random.normal(0, 1000, 5 * rate).astype(np.int16)
silence = np.zeros(5 * rate, dtype=np.int16)
audio = np.concatenate([noise, silence])
wavfile.write("test_with_silence.wav", rate, audio)
