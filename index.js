const { Ollama } = require("ollama");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.json({ message: "Servidor está funcionando!" });
});

async function chat(message, res) {
  try {
    const ollama = new Ollama({ host: "http://localhost:11434" });

    const messagesPrequel = [
      {
        role: "system",
        content:
          "Você é um assistente de IA que responde perguntas de forma simples e direta. Evite respstas longas, maximo de 2500 caracteres.",
      },
    ];

    const response = await ollama.chat({
      model: "gemma3:4b",
      messages: [...messagesPrequel, { role: "user", content: message }],
      stream: true,
    });

    // Configuração do SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const part of response) {
      const content = part.message.content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ error: "Erro ao processar a mensagem" });
  }
}

app.get("/chat", async (req, res) => {
  const { message } = req.query;
  if (!message) {
    return res.status(400).json({ error: "Mensagem é obrigatória" });
  }
  await chat(message, res);
});

app.listen(4343, () => {
  console.log("Server is running on port 4343");
});
