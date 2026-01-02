
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getStrategicHint, TargetCandidate } from '../services/geminiService';
import { Point, Bubble, Particle, BubbleColor, DebugInfo } from '../types';
import { Loader2, Trophy, BrainCircuit, Play, MousePointerClick, Terminal, AlertTriangle, Target, Lightbulb, Monitor, Zap } from 'lucide-react';

const PINCH_THRESHOLD = 0.05;
const GRAVITY = 0.0; 
const FRICTION = 0.999; // Slightly less friction for smoother long-distance glides

const BUBBLE_RADIUS = 22;
const ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3);
const GRID_COLS = 12;
const GRID_ROWS = 10;
const SLINGSHOT_BOTTOM_OFFSET = 220;

// Slower multipliers for "longer moving time"
const MAX_DRAG_DIST = 180;
const MIN_FORCE_MULT = 0.08; 
const MAX_FORCE_MULT = 0.22; 

const COLOR_CONFIG: Record<BubbleColor, { hex: string, points: number, label: string }> = {
  red:    { hex: '#ef5350', points: 100, label: 'Red' },
  blue:   { hex: '#42a5f5', points: 150, label: 'Blue' },
  green:  { hex: '#66bb6a', points: 200, label: 'Green' },
  yellow: { hex: '#ffee58', points: 250, label: 'Yellow' },
  purple: { hex: '#ab47bc', points: 300, label: 'Purple' },
  orange: { hex: '#ffa726', points: 500, label: 'Orange' }
};

const COLOR_KEYS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

const adjustColor = (color: string, amount: number) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
    const componentToHex = (c: number) => {
        const h = c.toString(16);
        return h.length === 1 ? "0" + h : h;
    };
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const GeminiSlingshot: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  
  const ballPos = useRef<Point>({ x: 0, y: 0 });
  const ballVel = useRef<Point>({ x: 0, y: 0 });
  const anchorPos = useRef<Point>({ x: 0, y: 0 });
  const isPinching = useRef<boolean>(false);
  const isFlying = useRef<boolean>(false);
  const flightStartTime = useRef<number>(0);
  const bubbles = useRef<Bubble[]>([]);
  const particles = useRef<Particle[]>([]);
  const scoreRef = useRef<number>(0);
  
  const aimTargetRef = useRef<Point | null>(null);
  const isAiThinkingRef = useRef<boolean>(false);
  const captureRequestRef = useRef<boolean>(false);
  const selectedColorRef = useRef<BubbleColor>('red');
  
  const [loading, setLoading] = useState(true);
  const [aiHint, setAiHint] = useState<string | null>("Calibrating tactical vision...");
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aimTarget, setAimTarget] = useState<Point | null>(null);
  const [score, setScore] = useState(0);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [selectedColor, setSelectedColor] = useState<BubbleColor>('red');
  const [availableColors, setAvailableColors] = useState<BubbleColor[]>([]);
  const [aiRecommendedColor, setAiRecommendedColor] = useState<BubbleColor | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  useEffect(() => { selectedColorRef.current = selectedColor; }, [selectedColor]);
  useEffect(() => { aimTargetRef.current = aimTarget; }, [aimTarget]);
  useEffect(() => { isAiThinkingRef.current = isAiThinking; }, [isAiThinking]);
  
  const getBubblePos = (row: number, col: number, width: number) => {
    const xOffset = (width - (GRID_COLS * BUBBLE_RADIUS * 2)) / 2 + BUBBLE_RADIUS;
    const isOdd = row % 2 !== 0;
    const x = xOffset + col * (BUBBLE_RADIUS * 2) + (isOdd ? BUBBLE_RADIUS : 0);
    const y = BUBBLE_RADIUS + row * ROW_HEIGHT;
    return { x, y };
  };

  const updateAvailableColors = () => {
    const activeColors = new Set<BubbleColor>();
    bubbles.current.forEach(b => { if (b.active) activeColors.add(b.color); });
    const list = Array.from(activeColors);
    setAvailableColors(list);
    if (!activeColors.has(selectedColorRef.current) && list.length > 0) {
        setSelectedColor(list[0]);
    }
  };

  const initGrid = useCallback((width: number) => {
    const newBubbles: Bubble[] = [];
    for (let r = 0; r < 5; r++) { 
      for (let c = 0; c < (r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS); c++) {
        if (Math.random() > 0.1) {
            const { x, y } = getBubblePos(r, c, width);
            newBubbles.push({
              id: `${r}-${c}`, row: r, col: c, x, y,
              color: COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)],
              active: true
            });
        }
      }
    }
    bubbles.current = newBubbles;
    updateAvailableColors();
    setTimeout(() => { captureRequestRef.current = true; }, 1000);
  }, []);

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      particles.current.push({
        x, y, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, life: 1.0, color
      });
    }
  };

  const isNeighbor = (a: Bubble, b: Bubble) => {
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (Math.abs(dr) > 1) return false;
    if (dr === 0) return Math.abs(dc) === 1;
    // Hex grid offset logic
    return a.row % 2 !== 0 ? (dc === 0 || dc === 1) : (dc === -1 || dc === 0);
  };

  const dropFloatingBubbles = () => {
    const activeBubbles = bubbles.current.filter(b => b.active);
    const connected = new Set<string>();
    const queue = activeBubbles.filter(b => b.row === 0);
    queue.forEach(b => connected.add(b.id));

    let head = 0;
    while(head < queue.length) {
      const curr = queue[head++];
      const neighbors = activeBubbles.filter(n => !connected.has(n.id) && isNeighbor(curr, n));
      neighbors.forEach(n => {
        connected.add(n.id);
        queue.push(n);
      });
    }

    let droppedCount = 0;
    bubbles.current.forEach(b => {
      if (b.active && !connected.has(b.id)) {
        b.active = false;
        createExplosion(b.x, b.y, COLOR_CONFIG[b.color].hex);
        // Bonus points for dropping clusters
        scoreRef.current += Math.floor(COLOR_CONFIG[b.color].points * 0.75);
        droppedCount++;
      }
    });
    if (droppedCount > 0) {
      setScore(scoreRef.current);
    }
  };

  const checkMatches = (startBubble: Bubble) => {
    const toCheck = [startBubble];
    const visited = new Set<string>();
    const matches: Bubble[] = [];
    const targetColor = startBubble.color;
    while (toCheck.length > 0) {
      const current = toCheck.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      if (current.color === targetColor) {
        matches.push(current);
        const neighbors = bubbles.current.filter(b => b.active && !visited.has(b.id) && isNeighbor(current, b));
        toCheck.push(...neighbors);
      }
    }
    if (matches.length >= 3) {
      let pts = 0;
      matches.forEach(b => {
        b.active = false;
        createExplosion(b.x, b.y, COLOR_CONFIG[b.color].hex);
        pts += COLOR_CONFIG[targetColor].points;
      });
      scoreRef.current += Math.floor(pts * (matches.length > 3 ? 1.5 : 1.0));
      setScore(scoreRef.current);
      // After popping a cluster, check for floating ones
      dropFloatingBubbles();
      return true;
    }
    return false;
  };

  const isPathClear = (target: Bubble) => {
    const startX = anchorPos.current.x;
    const startY = anchorPos.current.y;
    const dx = target.x - startX;
    const dy = target.y - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance / (BUBBLE_RADIUS / 2)); 

    for (let i = 1; i < steps - 2; i++) { 
        const t = i / steps;
        const cx = startX + dx * t;
        const cy = startY + dy * t;
        for (const b of bubbles.current) {
            if (!b.active || b.id === target.id) continue;
            const distSq = Math.pow(cx - b.x, 2) + Math.pow(cy - b.y, 2);
            if (distSq < Math.pow(BUBBLE_RADIUS * 1.8, 2)) return false; 
        }
    }
    return true;
  };

  const getAllReachableClusters = (): TargetCandidate[] => {
    const activeBubbles = bubbles.current.filter(b => b.active);
    const uniqueColors = Array.from(new Set(activeBubbles.map(b => b.color))) as BubbleColor[];
    const allClusters: TargetCandidate[] = [];

    for (const color of uniqueColors) {
        const visited = new Set<string>();
        for (const b of activeBubbles) {
            if (b.color !== color || visited.has(b.id)) continue;
            const clusterMembers: Bubble[] = [];
            const queue = [b];
            visited.add(b.id);
            while (queue.length > 0) {
                const curr = queue.shift()!;
                clusterMembers.push(curr);
                const neighbors = activeBubbles.filter(n => !visited.has(n.id) && n.color === color && isNeighbor(curr, n));
                neighbors.forEach(n => { visited.add(n.id); queue.push(n); });
            }
            clusterMembers.sort((a,b) => b.y - a.y); 
            const hittableMember = clusterMembers.find(m => isPathClear(m));
            if (hittableMember) {
                const xPct = hittableMember.x / (gameContainerRef.current?.clientWidth || window.innerWidth);
                let desc = xPct < 0.33 ? "Left" : xPct > 0.66 ? "Right" : "Center";
                allClusters.push({
                    id: hittableMember.id, color, size: clusterMembers.length,
                    row: hittableMember.row, col: hittableMember.col,
                    pointsPerBubble: COLOR_CONFIG[color].points, description: desc
                });
            }
        }
    }
    return allClusters;
  };

  const performAiAnalysis = async (screenshot: string) => {
    isAiThinkingRef.current = true;
    setIsAiThinking(true);
    setAiHint("Analyzing tactical options...");
    setAiRationale(null);

    const allClusters = getAllReachableClusters();
    const maxRow = bubbles.current.reduce((max, b) => b.active ? Math.max(max, b.row) : max, 0);
    const canvasWidth = canvasRef.current?.width || 1000;

    getStrategicHint(screenshot, allClusters, maxRow).then(aiResponse => {
        const { hint, debug } = aiResponse;
        setDebugInfo(debug);
        setAiHint(hint.message);
        setAiRationale(hint.rationale || null);
        if (typeof hint.targetRow === 'number' && typeof hint.targetCol === 'number') {
            if (hint.recommendedColor) {
                setAiRecommendedColor(hint.recommendedColor);
                setSelectedColor(hint.recommendedColor);
            }
            setAimTarget(getBubblePos(hint.targetRow, hint.targetCol, canvasWidth));
        }
        isAiThinkingRef.current = false;
        setIsAiThinking(false);
    }).catch(() => {
        setIsAiThinking(false);
        isAiThinkingRef.current = false;
    });
  };

  const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colorKey: BubbleColor) => {
    const baseColor = COLOR_CONFIG[colorKey].hex;
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.2, baseColor);
    grad.addColorStop(1, adjustColor(baseColor, -60));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = adjustColor(baseColor, -80);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.3, y - radius * 0.35, radius * 0.25, radius * 0.15, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  };

  const drawTrajectory = (ctx: CanvasRenderingContext2D, start: Point, vel: Point, width: number, color: string) => {
    let px = start.x;
    let py = start.y;
    let vx = vel.x;
    let vy = vel.y;
    
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -(performance.now() / 20) % 16;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.moveTo(px, py);

    for (let i = 0; i < 60; i++) { // More steps for longer visual trajectory
        px += vx * 2.5;
        py += vy * 2.5;
        if (px < BUBBLE_RADIUS || px > width - BUBBLE_RADIUS) {
            vx *= -1;
            px = Math.max(BUBBLE_RADIUS, Math.min(width - BUBBLE_RADIUS, px));
        }
        ctx.lineTo(px, py);
        if (py < 0) break;
        // Optimization: stop if we hit something potentially
        const hitIdx = bubbles.current.findIndex(b => b.active && Math.sqrt(Math.pow(px - b.x, 2) + Math.pow(py - b.y, 2)) < BUBBLE_RADIUS * 1.5);
        if (hitIdx !== -1) break;
    }
    ctx.stroke();
    ctx.restore();
  };

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !gameContainerRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
    ballPos.current = { ...anchorPos.current };
    initGrid(canvas.width);

    let camera: any = null;
    let hands: any = null;

    const onResults = (results: any) => {
      setLoading(false);
      setIsTracking(results.multiHandLandmarks && results.multiHandLandmarks.length > 0);

      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(18, 18, 18, 0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let handPos: Point | null = null;
      let pinchDist = 1.0;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const idxTip = landmarks[8];
        const thumbTip = landmarks[4];
        handPos = {
          x: (idxTip.x * canvas.width + thumbTip.x * canvas.width) / 2,
          y: (idxTip.y * canvas.height + thumbTip.y * canvas.height) / 2
        };
        const dx = idxTip.x - thumbTip.x;
        const dy = idxTip.y - thumbTip.y;
        pinchDist = Math.sqrt(dx * dx + dy * dy);

        if (window.drawConnectors && window.drawLandmarks) {
           window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {color: '#669df6', lineWidth: 1});
           window.drawLandmarks(ctx, landmarks, {color: '#aecbfa', lineWidth: 1, radius: 2});
        }
        ctx.beginPath();
        ctx.arc(handPos.x, handPos.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = pinchDist < PINCH_THRESHOLD ? '#66bb6a' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      const isLocked = isAiThinkingRef.current;
      if (!isLocked && handPos && pinchDist < PINCH_THRESHOLD && !isFlying.current) {
        const distToBall = Math.sqrt(Math.pow(handPos.x - ballPos.current.x, 2) + Math.pow(handPos.y - ballPos.current.y, 2));
        if (!isPinching.current && distToBall < 120) isPinching.current = true;
        if (isPinching.current) {
            ballPos.current = { x: handPos.x, y: handPos.y };
            const dragDx = ballPos.current.x - anchorPos.current.x;
            const dragDy = ballPos.current.y - anchorPos.current.y;
            const dragDist = Math.sqrt(dragDx*dragDx + dragDy*dragDy);
            if (dragDist > MAX_DRAG_DIST) {
                const angle = Math.atan2(dragDy, dragDx);
                ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
                ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
            }
        }
      } else if (isPinching.current && (!handPos || pinchDist >= PINCH_THRESHOLD || isLocked)) {
        isPinching.current = false;
        if (!isLocked) {
            const dx = anchorPos.current.x - ballPos.current.x;
            const dy = anchorPos.current.y - ballPos.current.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 30) {
                isFlying.current = true;
                flightStartTime.current = performance.now();
                const power = Math.min(dist / MAX_DRAG_DIST, 1.0);
                const mult = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (power * power);
                ballVel.current = { x: dx * mult, y: dy * mult };
            } else {
                ballPos.current = { ...anchorPos.current };
            }
        } else {
            ballPos.current = { ...anchorPos.current };
        }
      } else if (!isFlying.current && !isPinching.current) {
          ballPos.current.x += (anchorPos.current.x - ballPos.current.x) * 0.15;
          ballPos.current.y += (anchorPos.current.y - ballPos.current.y) * 0.15;
      }

      if (isFlying.current) {
        if (performance.now() - flightStartTime.current > 10000) { // Extended timeout for slower ball
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
        } else {
            // Smaller steps for more precision with slower motion
            const steps = Math.ceil(Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2) / (BUBBLE_RADIUS * 0.5)); 
            let collision = false;
            for (let i = 0; i < steps; i++) {
                ballPos.current.x += ballVel.current.x / steps;
                ballPos.current.y += ballVel.current.y / steps;
                if (ballPos.current.x < BUBBLE_RADIUS || ballPos.current.x > canvas.width - BUBBLE_RADIUS) {
                    ballVel.current.x *= -1;
                    ballPos.current.x = Math.max(BUBBLE_RADIUS, Math.min(canvas.width - BUBBLE_RADIUS, ballPos.current.x));
                }
                if (ballPos.current.y < BUBBLE_RADIUS) { collision = true; break; }
                for (const b of bubbles.current) {
                    if (b.active && Math.sqrt(Math.pow(ballPos.current.x - b.x, 2) + Math.pow(ballPos.current.y - b.y, 2)) < BUBBLE_RADIUS * 1.6) {
                        collision = true; break;
                    }
                }
                if (collision) break;
            }
            ballVel.current.x *= FRICTION; ballVel.current.y *= FRICTION;
            if (collision) {
                isFlying.current = false;
                let bestD = Infinity, br = 0, bc = 0, bx = 0, by = 0;
                // Snap to nearest grid slot
                for (let r = 0; r < GRID_ROWS + 5; r++) {
                    for (let c = 0; c < (r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS); c++) {
                        const pos = getBubblePos(r, c, canvas.width);
                        if (bubbles.current.some(b => b.active && b.row === r && b.col === c)) continue;
                        const d = Math.sqrt(Math.pow(ballPos.current.x - pos.x, 2) + Math.pow(ballPos.current.y - pos.y, 2));
                        if (d < bestD) { bestD = d; br = r; bc = c; bx = pos.x; by = pos.y; }
                    }
                }
                const nb: Bubble = { id: `${br}-${bc}-${Date.now()}`, row: br, col: bc, x: bx, y: by, color: selectedColorRef.current, active: true };
                bubbles.current.push(nb);
                checkMatches(nb);
                updateAvailableColors();
                ballPos.current = { ...anchorPos.current };
                captureRequestRef.current = true;
            }
        }
      }

      bubbles.current.forEach(b => { if (b.active) drawBubble(ctx, b.x, b.y, BUBBLE_RADIUS - 1, b.color); });

      // Trajectory Logic
      if (isPinching.current) {
          const dx = anchorPos.current.x - ballPos.current.x;
          const dy = anchorPos.current.y - ballPos.current.y;
          const power = Math.min(Math.sqrt(dx*dx + dy*dy) / MAX_DRAG_DIST, 1.0);
          const mult = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (power * power);
          drawTrajectory(ctx, anchorPos.current, { x: dx * mult, y: dy * mult }, canvas.width, COLOR_CONFIG[selectedColorRef.current].hex);
      } else if (aimTargetRef.current && !isFlying.current) {
          ctx.save();
          const target = aimTargetRef.current;
          ctx.beginPath();
          ctx.arc(target.x, target.y, BUBBLE_RADIUS + 5, 0, Math.PI * 2);
          ctx.strokeStyle = COLOR_CONFIG[selectedColorRef.current].hex;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.restore();
      }

      // Draw Bands
      const bandCol = isPinching.current ? '#fdd835' : 'rgba(255,255,255,0.4)';
      if (!isFlying.current) {
        ctx.beginPath(); ctx.moveTo(anchorPos.current.x - 35, anchorPos.current.y - 10); ctx.lineTo(ballPos.current.x, ballPos.current.y);
        ctx.lineWidth = 5; ctx.strokeStyle = bandCol; ctx.lineCap = 'round'; ctx.stroke();
      }
      drawBubble(ctx, ballPos.current.x, ballPos.current.y, BUBBLE_RADIUS, selectedColorRef.current);
      if (!isFlying.current) {
        ctx.beginPath(); ctx.moveTo(ballPos.current.x, ballPos.current.y); ctx.lineTo(anchorPos.current.x + 35, anchorPos.current.y - 10);
        ctx.lineWidth = 5; ctx.strokeStyle = bandCol; ctx.lineCap = 'round'; ctx.stroke();
      }

      // Slingshot Handle
      ctx.beginPath(); ctx.moveTo(anchorPos.current.x, canvas.height); ctx.lineTo(anchorPos.current.x, anchorPos.current.y + 40); 
      ctx.lineTo(anchorPos.current.x - 40, anchorPos.current.y); ctx.moveTo(anchorPos.current.x, anchorPos.current.y + 40);
      ctx.lineTo(anchorPos.current.x + 40, anchorPos.current.y); ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.strokeStyle = '#616161'; ctx.stroke();

      for (let i = particles.current.length - 1; i >= 0; i--) {
          const p = particles.current[i];
          p.x += p.vx; p.y += p.vy; p.life -= 0.05;
          if (p.life <= 0) particles.current.splice(i, 1);
          else { ctx.globalAlpha = p.life; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); ctx.globalAlpha = 1.0; }
      }
      ctx.restore();

      if (captureRequestRef.current) {
        captureRequestRef.current = false;
        const off = document.createElement('canvas');
        const sw = 480; const s = Math.min(1, sw / canvas.width);
        off.width = canvas.width * s; off.height = canvas.height * s;
        const oCtx = off.getContext('2d');
        if (oCtx) {
            oCtx.drawImage(canvas, 0, 0, off.width, off.height);
            const ss = off.toDataURL("image/jpeg", 0.7);
            setTimeout(() => performAiAnalysis(ss), 0);
        }
      }
    };

    if (window.Hands) {
      hands = new window.Hands({ locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      hands.onResults(onResults);
      if (window.Camera) {
        camera = new window.Camera(video, { onFrame: async () => { if (videoRef.current && hands) await hands.send({ image: videoRef.current }); }, width: 1280, height: 720 });
        camera.start();
      }
    }
    return () => { if (camera) camera.stop(); if (hands) hands.close(); };
  }, [initGrid]);

  const bColor = aiRecommendedColor ? COLOR_CONFIG[aiRecommendedColor].hex : '#444746';

  return (
    <div className="flex w-full h-screen bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3]">
      <div className="fixed inset-0 z-[100] bg-[#121212] flex flex-col items-center justify-center p-8 text-center md:hidden">
         <Monitor className="w-16 h-16 text-[#ef5350] mb-6 animate-pulse" />
         <h2 className="text-2xl font-bold mb-4">Desktop Required</h2>
      </div>

      <div ref={gameContainerRef} className="flex-1 relative h-full overflow-hidden">
        <video ref={videoRef} className="absolute hidden" playsInline />
        <canvas ref={canvasRef} className="absolute inset-0" />

        {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
                <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin" />
            </div>
        )}

        <div className="absolute top-6 left-6 z-40 flex flex-col gap-4">
            <div className="bg-[#1e1e1e] p-5 rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-4">
                <div className="bg-[#42a5f5]/20 p-3 rounded-full"><Trophy className="w-6 h-6 text-[#42a5f5]" /></div>
                <div><p className="text-xs text-[#c4c7c5] uppercase font-medium">Score</p><p className="text-3xl font-bold">{score.toLocaleString()}</p></div>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold uppercase transition-colors ${isTracking ? 'bg-[#66bb6a]/10 border-[#66bb6a]/30 text-[#66bb6a]' : 'bg-[#ef5350]/10 border-[#ef5350]/30 text-[#ef5350]'}`}>
                <Zap className={`w-3 h-3 ${isTracking ? 'fill-current' : ''}`} />
                {isTracking ? 'Live Tracking' : 'Looking for hands'}
            </div>
        </div>

        {isAiThinking && (
          <div className="absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center" style={{ bottom: '280px' }}>
             <div className="w-12 h-12 rounded-full border-4 border-t-[#a8c7fa] border-r-[#a8c7fa] border-b-transparent border-l-transparent animate-spin" />
             <p className="mt-2 text-[#a8c7fa] font-bold text-[10px] tracking-widest animate-pulse">THINKING...</p>
          </div>
        )}

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
            <div className="bg-[#1e1e1e] px-6 py-4 rounded-[32px] border border-[#444746] shadow-2xl flex items-center gap-4">
                {availableColors.length === 0 ? <p className="text-sm text-gray-500">No ammo</p> : 
                    COLOR_KEYS.filter(c => availableColors.includes(c)).map(color => (
                        <button key={color} onClick={() => setSelectedColor(color)} className={`relative w-14 h-14 rounded-full transition-all duration-300 transform flex items-center justify-center ${selectedColor === color ? 'scale-110 ring-4 ring-white/50 z-10' : 'opacity-80 hover:opacity-100 hover:scale-105'}`} style={{ background: `radial-gradient(circle at 35% 35%, ${COLOR_CONFIG[color].hex}, ${adjustColor(COLOR_CONFIG[color].hex, -60)})`, boxShadow: selectedColor === color ? `0 0 20px ${COLOR_CONFIG[color].hex}` : '0 4px 6px rgba(0,0,0,0.3)' }}>
                            <div className="absolute top-2 left-3 w-4 h-2 bg-white/40 rounded-full transform -rotate-45" />
                            {aiRecommendedColor === color && selectedColor !== color && <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-black text-[10px] font-bold flex items-center justify-center rounded-full animate-bounce">!</span>}
                            {selectedColor === color && <MousePointerClick className="w-6 h-6 text-white/90" />}
                        </button>
                    ))
                }
            </div>
        </div>

        {!isPinching.current && !isFlying.current && !isAiThinking && (
            <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 opacity-50">
                <div className="flex items-center gap-2 bg-[#1e1e1e]/90 px-4 py-2 rounded-full border border-[#444746]"><Play className="w-3 h-3 text-[#42a5f5] fill-current" /><p className="text-xs font-medium">Pinch & Pull to Shoot</p></div>
            </div>
        )}
      </div>

      <div className="w-[380px] bg-[#1e1e1e] border-l border-[#444746] flex flex-col h-full overflow-hidden shadow-2xl">
        <div className="p-5 border-b-4 transition-colors duration-500 flex flex-col gap-2" style={{ backgroundColor: '#252525', borderColor: bColor }}>
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><BrainCircuit className="w-5 h-5" style={{ color: bColor }} /><h2 className="font-bold text-sm tracking-widest uppercase" style={{ color: bColor }}>Strategic Intel</h2></div>
                {isAiThinking && <Loader2 className="w-4 h-4 animate-spin text-white/50" />}
             </div>
             <p className="text-sm leading-relaxed font-bold">{aiHint}</p>
             {aiRationale && <div className="flex gap-2 mt-1"><Lightbulb className="w-4 h-4 text-[#a8c7fa] shrink-0 mt-0.5" /><p className="text-[#a8c7fa] text-xs italic leading-tight">{aiRationale}</p></div>}
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {debugInfo?.screenshotBase64 && (
                <div>
                    <div className="flex items-center gap-2 mb-2 text-[#c4c7c5] text-xs font-bold uppercase"><Terminal className="w-3 h-3" /> Flash Vision</div>
                    <div className="rounded-lg overflow-hidden border border-[#444746] bg-black relative"><img src={debugInfo.screenshotBase64} alt="AI Vision" className="w-full opacity-80" /></div>
                </div>
            )}
            {debugInfo && (
                <div className="space-y-4">
                    <div className="bg-[#121212] p-3 rounded-lg border border-[#444746] font-mono text-[10px] text-gray-400 max-h-40 overflow-y-auto">{debugInfo.rawResponse}</div>
                    <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono"><span>LATENCY: {debugInfo.latency}ms</span><span>{debugInfo.timestamp}</span></div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default GeminiSlingshot;
