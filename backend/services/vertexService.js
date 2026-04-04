const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Functional equivalent of the user's provided Python snippet for Vertex AI.
 * Implements a sample call to gemini-2.5-flash for image/content generation.
 */
const generateGeminiContent = async (prompt, base64Image = null, mimeType = "image/jpeg") => {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });

        const parts = [prompt];
        
        if (base64Image) {
            parts.push({
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            });
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("[Vertex Service] Error generating content:", error.message);
        throw error;
    }
};

module.exports = {
    generateGeminiContent
};
