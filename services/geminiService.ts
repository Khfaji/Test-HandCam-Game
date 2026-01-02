
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from "@google/genai";
import { StrategicHint, AiResponse, DebugInfo } from "../types";

const MODEL_NAME = "gemini-3-flash-preview";

export interface TargetCandidate {
  id: string;
  color: string;
  size: number;
  row: number;
  col: number;
  pointsPerBubble: number;
  description: string;
}

export const getStrategicHint = async (
  imageBase64: string,
  validTargets: TargetCandidate[],
  dangerRow: number
): Promise<AiResponse> => {
  const startTime = performance.now();
  
  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64,
    promptContext: "",
    rawResponse: "",
    timestamp: new Date().toLocaleTimeString()
  };

  // Initialize right before call to ensure fresh environment/key
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const getBestLocalTarget = (msg: string = "No clear shots—play defensively."): StrategicHint => {
    if (validTargets.length > 0) {
        const best = [...validTargets].sort((a,b) => {
            const scoreA = a.size * a.pointsPerBubble;
            const scoreB = b.size * b.pointsPerBubble;
            return (scoreB - scoreA) || (a.row - b.row);
        })[0];
        
        return {
            message: `Fallback: Select ${best.color.toUpperCase()} at Row ${best.row}`,
            rationale: "Selected based on highest potential cluster score available locally.",
            targetRow: best.row,
            targetCol: best.col,
            recommendedColor: best.color as any
        };
    }
    return { message: msg, rationale: "No valid clusters found to target." };
  };

  const hasDirectTargets = validTargets.length > 0;
  const targetListStr = hasDirectTargets 
    ? validTargets.map(t => 
        `- OPTION: Select ${t.color.toUpperCase()} (${t.pointsPerBubble} pts/bubble) -> Target [Row ${t.row}, Col ${t.col}]. Cluster Size: ${t.size}. Total Value: ${t.size * t.pointsPerBubble}.`
      ).join("\n")
    : "NO MATCHES AVAILABLE. Suggest a color to set up a future combo.";
  
  debug.promptContext = targetListStr;

  const prompt = `
    You are a strategic gaming AI analyzing a Bubble Shooter game where the player can CHOOSE their projectile color.
    I have provided a screenshot of the current board and a list of valid targets for all available colors.

    ### GAME STATE
    - Danger Level: ${dangerRow >= 6 ? "CRITICAL" : "Stable"}
    
    ### SCORING RULES
    - Red: 100, Blue: 150, Green: 200, Yellow: 250, Purple: 300, Orange: 500

    ### AVAILABLE MOVES
    ${targetListStr}

    ### TASK
    Analyze the board and choose the BEST color and target. Prioritize clearing clusters or dropping bubbles.
    Return RAW JSON only.

    JSON structure:
    {
      "message": "Short directive",
      "rationale": "One sentence explanation",
      "recommendedColor": "red|blue|green|yellow|purple|orange",
      "targetRow": integer,
      "targetCol": integer
    }
  `;

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
            { text: prompt },
            { 
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64
              } 
            }
        ]
      },
      config: {
        temperature: 0.2,
        responseMimeType: "application/json" 
      }
    });

    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    
    let text = response.text || "{}";
    debug.rawResponse = text;
    
    try {
        const json = JSON.parse(text);
        debug.parsedResponse = json;
        
        const r = Number(json.targetRow);
        const c = Number(json.targetCol);
        
        if (!isNaN(r) && !isNaN(c) && json.recommendedColor) {
            return {
                hint: {
                    message: json.message || "Good shot available!",
                    rationale: json.rationale,
                    targetRow: r,
                    targetCol: c,
                    recommendedColor: json.recommendedColor.toLowerCase()
                },
                debug
            };
        }
        return {
            hint: getBestLocalTarget("AI coordination error"),
            debug: { ...debug, error: "Invalid Coordinates" }
        };
    } catch (e: any) {
        return {
            hint: getBestLocalTarget("AI parse error"),
            debug: { ...debug, error: `JSON Parse Error: ${e.message}` }
        };
    }
  } catch (error: any) {
    return {
        hint: getBestLocalTarget("AI unreachable"),
        debug: { ...debug, error: error.message || "API Error" }
    };
  }
};
