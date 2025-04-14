const { Ollama } = require("ollama");
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());
app.use(cors());

// Armazenamento em memória das conversas e respostas
const conversations = new Map();
const responseQueues = new Map();
const responseListeners = new Map();

app.get("/", (req, res) => {
  res.json({ message: "Servidor está funcionando!" });
});

async function processMessage(message, conversationId) {
  try {
    const ollama = new Ollama({ host: "http://localhost:11434" });

    // Recupera ou inicializa o histórico da conversa
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, [
        {
          role: "system",
          content:
            "Você é um assistente de IA que responde perguntas de forma simples e direta. Evite respstas longas, maximo de 2500 caracteres.",
        },
      ]);
    }

    const messages = conversations.get(conversationId);
    messages.push({ role: "user", content: message });

    const response = await ollama.chat({
      model: "gemma3:1b",
      messages: messages,
      stream: true,
    });

    let fullResponse = "";
    for await (const part of response) {
      const content = part.message.content;
      fullResponse += content;

      // Adiciona a parte da resposta à fila
      if (responseQueues.has(conversationId)) {
        responseQueues.get(conversationId).push(content);

        // Notifica os listeners
        const listeners = responseListeners.get(conversationId) || [];
        listeners.forEach((listener) => listener(content));
      }
    }

    // Adiciona a resposta completa ao histórico
    messages.push({ role: "assistant", content: fullResponse });
    conversations.set(conversationId, messages);

    // Marca a conversa como concluída
    if (responseQueues.has(conversationId)) {
      responseQueues.get(conversationId).push(null); // null indica fim da conversa

      // Notifica os listeners do fim
      const listeners = responseListeners.get(conversationId) || [];
      listeners.forEach((listener) => listener(null));
    }
  } catch (error) {
    console.error("Erro:", error);
    if (responseQueues.has(conversationId)) {
      responseQueues
        .get(conversationId)
        .push({ error: "Erro ao processar a mensagem" });

      // Notifica os listeners do erro
      const listeners = responseListeners.get(conversationId) || [];
      listeners.forEach((listener) =>
        listener({ error: "Erro ao processar a mensagem" })
      );
    }
  }
}

app.post("/chat", async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Mensagem é obrigatória" });
  }

  // Se não houver conversationId, gera um novo
  const id = conversationId || uuidv4();

  // Inicializa a fila de respostas e listeners
  responseQueues.set(id, []);
  responseListeners.set(id, new Set());

  // Inicia o processamento em background
  processMessage(message, id);

  // Responde imediatamente com o ID da conversa
  res.json({ conversationId: id });
});

app.get("/chat/:conversationId", (req, res) => {
  const { conversationId } = req.params;

  // Configuração do SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Função para enviar dados via SSE
  const sendSSE = (data) => {
    if (data === null) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (data.error) {
      res.write(`data: ${JSON.stringify({ error: data.error })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ content: data })}\n\n`);
  };

  // Adiciona o listener para esta conexão
  const listeners = responseListeners.get(conversationId) || new Set();
  listeners.add(sendSSE);
  responseListeners.set(conversationId, listeners);

  // Envia as partes já recebidas
  const queue = responseQueues.get(conversationId) || [];
  queue.forEach((part) => {
    if (part !== undefined) {
      sendSSE(part);
    }
  });

  // Limpa a conexão quando o cliente desconectar
  req.on("close", () => {
    const listeners = responseListeners.get(conversationId);
    if (listeners) {
      listeners.delete(sendSSE);
      if (listeners.size === 0) {
        responseListeners.delete(conversationId);
        responseQueues.delete(conversationId);
      }
    }
  });
});

app.listen(4343, () => {
  console.log("Server is running on port 4343");
});
