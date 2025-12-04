import { GoogleGenAI, FunctionDeclaration, Type, Tool } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";
import { querySalesData } from "./dataService";
import { FilterParams } from "../types";

let client: GoogleGenAI | null = null;

const getClient = () => {
  if (!client) {
    const apiKey = process.env.API_KEY || ''; // Injected by environment
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

// Define the tool
const querySalesTool: FunctionDeclaration = {
  name: "query_sales_data",
  description: "Queries the sales SQL database. Use this to find revenue, sales counts, filtering by seller, date, or product.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      seller: {
        type: Type.STRING,
        description: "Name of the seller (e.g., Carlos, Ana, Beatriz).",
      },
      product: {
        type: Type.STRING,
        description: "Name of the product.",
      },
      category: {
        type: Type.STRING,
        description: "Product category (Electronics, Computers, etc).",
      },
      region: {
        type: Type.STRING,
        description: "Sales region (Sul, Norte, Sudeste, etc).",
      },
      startDate: {
        type: Type.STRING,
        description: "Start date in YYYY-MM-DD format.",
      },
      endDate: {
        type: Type.STRING,
        description: "End date in YYYY-MM-DD format.",
      },
    },
  },
};

const tools: Tool[] = [{ functionDeclarations: [querySalesTool] }];

export const sendMessageToAgent = async (
  message: string, 
  history: any[]
): Promise<{ text: string; data?: any }> => {
  const ai = getClient();
  
  // Clean history for the API (API expects 'user' and 'model' roles)
  const chatHistory = history.map(h => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: [{ text: h.content }]
  }));

  const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: tools,
    },
    history: chatHistory
  });

  try {
    const result = await chat.sendMessage({ message });
    
    // Check for function calls
    const candidates = result.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No response candidates");
    }

    const firstCandidate = candidates[0];
    const parts = firstCandidate.content.parts;
    
    let responseText = "";
    let dataContext = null;

    // Handle Function Calls
    for (const part of parts) {
      if (part.functionCall) {
        const call = part.functionCall;
        
        if (call.name === 'query_sales_data') {
          const args = call.args as FilterParams;
          console.log("Agent calling tool:", call.name, args);
          
          // Execute the "SQL" query
          dataContext = await querySalesData(args);

          // Send result back to Gemini
          const functionResponse = await chat.sendMessage({
            message: [{
              functionResponse: {
                name: call.name,
                response: { result: dataContext }
              }
            }]
          });

          responseText = functionResponse.text;
        }
      } else if (part.text) {
        responseText += part.text;
      }
    }

    return {
      text: responseText || "Desculpe, não consegui processar essa solicitação.",
      data: dataContext
    };

  } catch (error) {
    console.error("Gemini Error:", error);
    return { text: "Ocorreu um erro ao comunicar com o agente de IA. Verifique sua chave de API." };
  }
};
