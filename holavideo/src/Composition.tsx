import React from 'react';
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const si = (f: number, inp: number[], out: number[], opts?: any) => {
    const pairs = inp.map((v, i) => [v, out[i]] as [number, number]);
    pairs.sort((a, b) => a[0] - b[0]);
    const deduped = pairs.filter((p, i) => i === 0 || p[0] > pairs[i - 1][0]);
    return interpolate(f, deduped.map(p => p[0]), deduped.map(p => p[1]), opts);
  };

  const T = 20;
  const z1 = Math.floor(durationInFrames / 2);

  const act1Op = si(frame, [0, T, z1 - T, z1], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const act2Op = si(frame, [z1, z1 + T, durationInFrames - T, durationInFrames], [0, 1, 1, 0], { extrapolateRight: 'clamp' });

  const nintendoX = si(frame, [0, 25], [-400, 20], { easing: Easing.out(Easing.cubic) });
  const nintendoOp = si(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  
  const lineP = si(frame, [20, 80], [0, 1], { extrapolateRight: 'clamp' });
  const text1Len = Math.floor(si(frame, [30, 90], [0, 28], { extrapolateRight: 'clamp' }));
  const text2Len = Math.floor(si(frame, [z1 + 20, z1 + 90], [0, 31], { extrapolateRight: 'clamp' }));

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-radial-gradient(circle at 50% 50%, #1a0505 0%, #000 50%)' }} />
      
      <Img 
        src={staticFile('entity_nintendo.png')} 
        style={{
          position: 'absolute',
          top: '50%',
          left: nintendoX,
          transform: 'translateY(-50%)',
          objectFit: 'contain',
          maxHeight: '85%',
          maxWidth: '40%',
          opacity: nintendoOp,
          filter: 'drop-shadow(0 0 18px rgba(0,200,255,0.5))'
        }} 
      />

      <div style={{ position: 'absolute', inset: 0, opacity: act1Op }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M 400,100 Q 640,360 800,600" fill="none" stroke="#fff" strokeWidth={1} strokeDasharray={1000} strokeDashoffset={1000 * (1 - lineP)} />
        </svg>
        <div style={{ position: 'absolute', right: 50, top: 200, color: '#ff0000', fontSize: 36, fontWeight: 'bold', fontFamily: 'monospace' }}>
          {"PLANOS TÉCNICOS: ¿PERMITIREMOS ESTO?".slice(0, text1Len)}
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 70% 30%, rgba(255,0,0,0.2), transparent 50%)' }} />
      </div>

      <div style={{ position: 'absolute', inset: 0, opacity: act2Op }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,0,0,0.1)' }} />
        <div style={{ position: 'absolute', right: 50, top: 400, color: '#ccff00', fontSize: 36, fontWeight: 'bold', fontFamily: 'monospace', textShadow: '2px 2px 4px #000' }}>
          {"LA SOMBRA DE NINTENDO SE EXPANDE".slice(0, text2Len)}
        </div>
        {new Array(20).fill(0).map((_, i) => (
          <div key={i} style={{ 
            position: 'absolute', 
            left: Math.random() * 1280, 
            top: (frame * (i + 1)) % 720, 
            width: 4, height: 4, background: '#fff', borderRadius: '50%', opacity: 0.3 
          }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};