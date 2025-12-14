const OpenAI = require("openai");

class OpenAi {
  constructor(apiKey = "") {
    this.openai = new OpenAI({ apiKey });
  }

  async embedTextChunk(textChunk = "") {
    const { data } = await this.openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: textChunk,
    });
    return data.length > 0 && data[0].hasOwnProperty("embedding")
      ? data[0].embedding
      : null;
  }

  async embedTextChunks(chunks = []) {
    const { data } = await this.openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: chunks,
    });
    return data.length > 0 &&
      data.every((embd) => embd.hasOwnProperty("embedding"))
      ? data.map((embd) => embd.embedding)
      : null;
  }
}

module.exports = {
  OpenAi,
};
