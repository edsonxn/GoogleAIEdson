import React from 'react';
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const si = (f: number, inp: number[], out: number[], opts?: any) => {
    const pairs = inp.map((v, i) => [v, out[i]] as [number, number]);
    pairs.sort((a, b) => a[0] - b[0]);
    const deduped = pairs.filter((p, i) => i === 0 || p[0] > pairs[i-1][0]);
    return interpolate(f, deduped.map(p => p[0]), deduped.map(p => p[1]), opts);
  };

  const RED = '#ff4444';
  const BLUE = '#00ffff';
  const WHITE = '#e0f7fa';
  const DARK_BLUE = '#01050a'; 

  const T = 18; 
  const z1 = Math.floor(durationInFrames / 3); 
  const z2 = Math.floor(2 * durationInFrames / 3); 

  const act1Op = si(frame, [0, T, Math.max(T + 1, z1 - T), z1], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const act2Op = si(frame, [z1, z1 + T, Math.max(z1 + T + 1, z2 - T), z2], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const act3Op = si(frame, [z2, z2 + T, Math.max(z2 + T + 1, durationInFrames - 8), durationInFrames], [0, 1, 1, 0], { extrapolateRight: 'clamp' });

  const mitchellOverallScale = si(frame, [0, durationInFrames], [1, 1.08]);

  const camX = si(frame,
    [0, 80, z1-10, z1+T, z2-20, z2+T, durationInFrames-20, durationInFrames],
    [0, -250, -250, -250, 0, 0, 0, 0],
    { extrapolateRight: 'clamp', easing: Easing.bezier(0.42, 0, 0.58, 1) }
  );
  const camY = si(frame,
    [0, 80, z1-10, z1+T, z2-20, z2+T, durationInFrames-20, durationInFrames],
    [0, -100, -100, -100, 100, 100, 0, 0],
    { extrapolateRight: 'clamp', easing: Easing.bezier(0.42, 0, 0.58, 1) }
  );
  const camScale = si(frame,
    [0, 30, 80, z1-10, z1+T, z1+T+60, z2-20, z2+T, z2+T+60, durationInFrames],
    [1, 1.1, 1.1, 1.2, 1.2, 1.0, 1.0, 1.0, 0.95, 0.95],
    { extrapolateRight: 'clamp', easing: Easing.bezier(0.42, 0, 0.58, 1) }
  );

  const gPhase = Math.floor(frame / 2) % 5;
  const mitchellGlitchOp = frame < 30 ? (gPhase < 3 ? 1 : 0) : 1;
  const mitchellGlitchX = frame < 30 ? (gPhase === 1 ? -4 : gPhase === 3 ? 3 : 0) : 0;
  const mitchellOp = si(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  const line1Progress = si(frame, [z1 * 0.25, z1 * 0.85], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(0.42, 0, 0.58, 1) });
  const pathLen1 = 800; 

  const chipEnterOp = si(frame, [z1 + T, z1 + T + 20], [0, 1], { extrapolateRight: 'clamp' });
  const chipEnterScale = si(frame, [z1 + T, z1 + T + 20], [0.8, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const chipText = "NÚCLEO DE EMULACIÓN";
  const chipCharsVisible = Math.floor(si(frame, [z1 + T + 30, z1 + T + 60], [0, chipText.length], { extrapolateRight: 'clamp' }));

  const line2Progress = si(frame, [z1 + T + 20, z2 - 20], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(0.42, 0, 0.58, 1) });
  const pathLen2 = 700; 

  const vhsItems = [
    { x: 540, y: 600, rot: -8 },
    { x: 640, y: 600, rot: 0 },
    { x: 740, y: 600, rot: 8 },
  ];
  const collapseText = "COLAPSO DE LA REPUTACIÓN";
  const collapseCharsVisible = Math.floor(si(frame, [z2 + T + 50, z2 + T + 90], [0, collapseText.length], { extrapolateRight: 'clamp' }));

  const spotR = si(frame, [z2+T+30, z2+T+80], [0, 400], { extrapolateRight: 'clamp' });
  const spotOpacity = si(frame, [z2+T+30, z2+T+80, durationInFrames-30, durationInFrames], [0, 1, 1, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: DARK_BLUE, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 90% 60% at 50% 50%, ${BLUE}08 0%, transparent 70%)` }} />

      <div style={{
        transform: `translate(${camX}px, ${camY}px) scale(${camScale})`,
        transformOrigin: 'center center',
        width: '100%',
        height: '100%',
        position: 'absolute',
      }}>

        <div style={{ position: 'absolute', inset: 0, opacity: act1Op }}>
          <Img
            src={staticFile('ra_manual_mitchell.png')}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: `translate(-50%,-50%) scale(${mitchellOverallScale}) translateX(${mitchellGlitchX}px)`,
              opacity: mitchellOp * mitchellGlitchOp,
              objectFit: 'contain',
              height: 'auto',
              maxHeight: '85%',
              maxWidth: '80%',
              width: 'auto',
              filter: 'drop-shadow(0 0 18px rgba(0,200,255,0.5))',
            }}
          />
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            <path d="M 640,360 Q 980,100 1150,220" fill="none" stroke={RED} strokeWidth={3}
              strokeDasharray={pathLen1} strokeDashoffset={pathLen1 * (1 - line1Progress)} strokeLinecap="round" />
            <circle cx={640} cy={360} r={7} fill={BLUE} opacity={line1Progress > 0.05 ? 1 : 0} />
            <circle cx={1150} cy={220} r={7} fill={RED} opacity={line1Progress > 0.95 ? 1 : 0} />
          </svg>
        </div>

        <div style={{ position: 'absolute', inset: 0, opacity: act2Op }}>
          <div style={{
            position: 'absolute',
            left: 1150, 
            top: 220,
            transform: `translate(-50%, -50%) scale(${chipEnterScale})`,
            opacity: chipEnterOp,
            width: 150,
            height: 100,
            backgroundColor: WHITE,
            borderRadius: 15,
            boxShadow: `0 0 25px ${BLUE}88, inset 0 0 15px ${BLUE}44`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: DARK_BLUE, letterSpacing: 1, textAlign: 'center' }}>
              {chipText.slice(0, chipCharsVisible)}
              <span style={{ opacity: frame % 20 < 10 ? 1 : 0 }}>|</span>
            </div>
            <div style={{ width: '80%', height: 2, background: BLUE, margin: '8px 0', opacity: chipEnterOp }} />
            <div style={{ display: 'flex', gap: 5 }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: BLUE, opacity: si(frame, [z1+T+10+i*5, z1+T+30+i*5], [0,1], {extrapolateRight: 'clamp'}) }} />
              ))}
            </div>
          </div>

          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            <path d="M 1150,220 Q 900,450 640,600" fill="none" stroke={RED} strokeWidth={3}
              strokeDasharray={pathLen2} strokeDashoffset={pathLen2 * (1 - line2Progress)} strokeLinecap="round" />
            <circle cx={1150} cy={220} r={7} fill={RED} opacity={line2Progress > 0.05 ? 1 : 0} />
            <circle cx={640} cy={600} r={7} fill={BLUE} opacity={line2Progress > 0.95 ? 1 : 0} />
          </svg>
        </div>

        <div style={{ position: 'absolute', inset: 0, opacity: act3Op }}>
          {vhsItems.map((vhs, i) => {
            const vhsOp = si(frame, [z2 + T + (i * 15), z2 + T + (i * 15) + 20], [0, 1], { extrapolateRight: 'clamp' });
            const vhsY = si(frame, [z2 + T + (i * 15), z2 + T + (i * 15) + 20], [30, 0], { extrapolateRight: 'clamp' });
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: vhs.x,
                  top: vhs.y,
                  width: 140,
                  height: 90,
                  backgroundColor: WHITE,
                  borderRadius: 8,
                  transform: `translate(-50%, -50%) translateY(${vhsY}px) rotate(${vhs.rot}deg)`,
                  opacity: vhsOp,
                  boxShadow: `0 8px 20px rgba(0,0,0,0.5), inset 0 0 10px ${BLUE}22`,
                  border: `2px solid ${BLUE}88`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'monospace',
                  fontSize: 14,
                  fontWeight: 600,
                  color: DARK_BLUE,
                }}
              >
                VHS-{i + 1}
                <div style={{position:'absolute', width:'80%', height:5, background:DARK_BLUE, bottom:10, borderRadius:2}} />
              </div>
            );
          })}

          <div style={{
            position: 'absolute',
            left: '50%',
            top: 450,
            transform: 'translateX(-50%)',
            opacity: si(frame, [z2 + T + 40, z2 + T + 60], [0, 1]),
            fontFamily: 'monospace',
            fontSize: 42,
            fontWeight: 900,
            letterSpacing: 4,
            color: RED,
            textShadow: `0 0 20px ${RED}88`,
            textAlign: 'center',
          }}>
            {collapseText.slice(0, collapseCharsVisible)}
            <span style={{ opacity: frame % 20 < 10 ? 1 : 0, color: BLUE }}>_</span>
          </div>

          <div style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle ${spotR}px at 640px 520px, transparent 0%, rgba(0,0,0,0.93) 100%)`,
            pointerEvents: 'none',
            opacity: spotOpacity
          }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};