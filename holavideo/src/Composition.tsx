import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Color Palette - Childish Crayon Primary Colors
  const COLOR_BG = '#fffbf0'; // Cream paper
  const COLOR_RED = '#ff3f34';
  const COLOR_BLUE = '#1e90ff';
  const COLOR_YELLOW = '#ffd32a';
  const COLOR_GREEN = '#05c46b';
  const COLOR_PURPLE = '#a55eea';
  const COLOR_INK = '#2f3542'; // Dark crayon outline

  // Main Fades & Transitions
  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [250, 269], [1, 0], { extrapolateRight: 'clamp' });

  // Custom elastic bezier curve for bouncy childlike pop transitions
  const elasticBounce = Easing.bezier(0.175, 0.885, 0.32, 1.275);

  // Crayon "Boiling/Wobbling" Loop Effect (recalculates every 4 frames)
  const boil = Math.floor(frame / 4);
  const bx = Math.sin(boil * 1.5) * 2.5;
  const by = Math.cos(boil * 1.1) * 2.5;
  const brot = Math.sin(boil * 0.8) * 1.5;

  const bx2 = Math.cos(boil * 1.9) * 2;
  const by2 = Math.sin(boil * 1.4) * 2;

  // Man / Dad Scale Transition
  const manScale = interpolate(frame, [15, 45], [0, 1], { extrapolateRight: 'clamp', easing: elasticBounce });

  // Screen Entrance Scales
  const screen1Scale = interpolate(frame, [35, 55], [0, 1], { extrapolateRight: 'clamp', easing: elasticBounce });
  const screen2Scale = interpolate(frame, [60, 80], [0, 1], { extrapolateRight: 'clamp', easing: elasticBounce });
  const screen3Scale = interpolate(frame, [85, 105], [0, 1], { extrapolateRight: 'clamp', easing: elasticBounce });
  const screen4Scale = interpolate(frame, [110, 130], [0, 1], { extrapolateRight: 'clamp', easing: elasticBounce });

  // Connecting line drawing progresses (strictly increasing input ranges)
  const line1Progress = interpolate(frame, [45, 70], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const line2Progress = interpolate(frame, [70, 95], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const line3Progress = interpolate(frame, [95, 120], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const line4Progress = interpolate(frame, [120, 145], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });

  // Radar Ping Waves (Crayon signals expanding outwards)
  const ping1 = interpolate(frame % 50, [0, 50], [0, 1], { extrapolateRight: 'clamp' });
  const ping2 = interpolate((frame + 25) % 50, [0, 50], [0, 1], { extrapolateRight: 'clamp' });

  // Numeric Counter values for screen stats
  const megaDataCounter = Math.floor(interpolate(frame, [90, 250], [100, 9999], { extrapolateRight: 'clamp' }));

  // Main Caption typewriter
  const captionText = "¡Este es papá trabajando en su súper oficina!";
  const charsVisible = Math.floor(interpolate(frame, [15, 140], [0, captionText.length], { extrapolateRight: 'clamp' }));

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR_BG, opacity: fadeIn * fadeOut, fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {/* Paper texture overlay */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.08, backgroundImage: 'radial-gradient(#2f3542 1px, transparent 1px)', backgroundSize: '24px 24px', pointerEvents: 'none' }} />
      
      {/* SVG lines and pings */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        {/* Radar wave signals under Dad */}
        <circle cx={640} cy={360} r={ping1 * 130} fill="none" stroke={COLOR_YELLOW} strokeWidth={4} strokeLinecap="round" strokeDasharray="6,6" opacity={1 - ping1} />
        <circle cx={640} cy={360} r={ping2 * 130} fill="none" stroke={COLOR_GREEN} strokeWidth={4} strokeLinecap="round" strokeDasharray="6,6" opacity={1 - ping2} />
        
        {/* Curved connecting crayon lines from Dad to each office screen */}
        <path d="M 640,360 Q 480,240 320,200" fill="none" stroke={COLOR_INK} strokeWidth={5} strokeLinecap="round" strokeDasharray={400} strokeDashoffset={400 * (1 - line1Progress)} />
        <path d="M 640,360 Q 800,240 960,200" fill="none" stroke={COLOR_INK} strokeWidth={5} strokeLinecap="round" strokeDasharray={400} strokeDashoffset={400 * (1 - line2Progress)} />
        <path d="M 640,360 Q 480,480 320,520" fill="none" stroke={COLOR_INK} strokeWidth={5} strokeLinecap="round" strokeDasharray={400} strokeDashoffset={400 * (1 - line3Progress)} />
        <path d="M 640,360 Q 800,480 960,520" fill="none" stroke={COLOR_INK} strokeWidth={5} strokeLinecap="round" strokeDasharray={400} strokeDashoffset={400 * (1 - line4Progress)} />
      </svg>

      {/* Dad (Center Character) */}
      <div style={{
        position: 'absolute',
        left: 640 - 90,
        top: 360 - 90,
        width: 180,
        height: 180,
        backgroundColor: COLOR_YELLOW,
        border: `6px solid ${COLOR_INK}`,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '8px 8px 0px rgba(47, 53, 66, 0.15)',
        transform: `scale(${manScale}) translate(${bx}px, ${by}px) rotate(${brot}deg)`,
      }}>
        <span style={{ fontSize: 90 }}>👨‍💻</span>
      </div>

      {/* Screen 1 (Top Left) */}
      <div style={{
        position: 'absolute',
        left: 220,
        top: 100,
        width: 200,
        height: 150,
        backgroundColor: COLOR_BLUE,
        border: `5px solid ${COLOR_INK}`,
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '6px 6px 0px rgba(47, 53, 66, 0.15)',
        transform: `scale(${screen1Scale}) translate(${bx2}px, ${by2}px)`,
      }}>
        <span style={{ fontSize: 45 }}>💻</span>
        <span style={{ color: '#fff', fontWeight: 'bold', marginTop: 5, fontSize: 16 }}>SÚPER PC</span>
      </div>

      {/* Screen 2 (Top Right) */}
      <div style={{
        position: 'absolute',
        left: 820,
        top: 100,
        width: 200,
        height: 150,
        backgroundColor: COLOR_RED,
        border: `5px solid ${COLOR_INK}`,
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '6px 6px 0px rgba(47, 53, 66, 0.15)',
        transform: `scale(${screen2Scale}) translate(${bx}px, ${by2}px)`,
      }}>
        <span style={{ fontSize: 35 }}>📊</span>
        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>
          {megaDataCounter}
        </span>
        <span style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>DATOS PROCESADOS</span>
      </div>

      {/* Screen 3 (Bottom Left) */}
      <div style={{
        position: 'absolute',
        left: 220,
        top: 470,
        width: 200,
        height: 150,
        backgroundColor: COLOR_GREEN,
        border: `5px solid ${COLOR_INK}`,
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '6px 6px 0px rgba(47, 53, 66, 0.15)',
        transform: `scale(${screen3Scale}) translate(${bx2}px, ${by}px)`,
      }}>
        <span style={{ fontSize: 45 }}>☕</span>
        <span style={{ color: '#fff', fontWeight: 'bold', marginTop: 5, fontSize: 16 }}>CAFÉ: 100%</span>
      </div>

      {/* Screen 4 (Bottom Right) */}
      <div style={{
        position: 'absolute',
        left: 820,
        top: 470,
        width: 200,
        height: 150,
        backgroundColor: COLOR_PURPLE,
        border: `5px solid ${COLOR_INK}`,
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '6px 6px 0px rgba(47, 53, 66, 0.15)',
        transform: `scale(${screen4Scale}) translate(${bx}px, ${by}px)`,
      }}>
        <span style={{ fontSize: 45 }}>🚀</span>
        <span style={{ color: '#fff', fontWeight: 'bold', marginTop: 5, fontSize: 16 }}>SÚPER VELOZ</span>
      </div>

      {/* Bottom Caption Typewriter */}
      <div style={{
        position: 'absolute',
        bottom: 40,
        left: '5%',
        right: '5%',
        height: 80,
        backgroundColor: '#fff',
        border: `5px solid ${COLOR_INK}`,
        borderRadius: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 20px',
        boxShadow: '8px 8px 0px rgba(47, 53, 66, 0.15)',
      }}>
        <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 'bold', color: COLOR_INK, textAlign: 'center' }}>
          {captionText.slice(0, charsVisible)}
          <span style={{ opacity: frame % 20 < 10 ? 1 : 0, color: COLOR_RED }}>|</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};