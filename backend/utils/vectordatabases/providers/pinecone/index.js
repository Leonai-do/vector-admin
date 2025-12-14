const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { OpenAi } = require("../../../openAi");
const { v4 } = require("uuid");
const { DocumentVectors } = require("../../../../models/documentVectors");
const { toChunks } = require("../../utils");
const { storeVectorResult } = require("../../../storage");
const { WorkspaceDocument } = require("../../../../models/workspaceDocument");
const { Pinecone } = require("@pinecone-database/pinecone");

class PineconeProvider {
  constructor(connector) {
    this.name = "pinecone";
    this.config = this.setConfig(connector);
  }

  setConfig(config) {
    var { type, settings } = config;
    if (typeof settings === "string") settings = JSON.parse(settings);
    return { type, settings };
  }

  async connect() {
    const { type, settings } = this.config;

    if (type !== "pinecone")
      throw new Error("Pinecone::Invalid Not a Pinecone connector instance.");

    const client = new Pinecone({
      apiKey: settings.apiKey,
    });

    const pineconeIndex = client.index(settings.index);
    
    // Verify connection/index existence
    try {
      const description = await client.describeIndex(settings.index);
      if (!description || description.status.state !== "Ready") {
        throw new Error("Pinecone::Index not ready.");
      }
      return { client, pineconeIndex, host: description.host };
    } catch (e) {
      throw new Error(`Pinecone::Connection failed: ${e.message}`);
    }
  }

  async indexDimensions() {
    const { pineconeIndex } = await this.connect();
    try {
      const stats = await pineconeIndex.describeIndexStats();
      return Number(stats.dimension || 1536);
    } catch (e) {
      console.error("Pinecone::indexDimensions error", e);
      return 1536; // Fallback
    }
  }

  async describeIndexRaw() {
    const { settings } = this.config;
    try {
      const client = new Pinecone({ apiKey: settings.apiKey });
      const description = await client.describeIndex(settings.index);
      return {
        database: {
          name: description.name,
          dimension: description.dimension,
          metric: description.metric,
        },
        status: {
          ready: description.status.state === "Ready",
          host: description.host,
          state: description.status.state,
        },
      };
    } catch (e) {
      console.error("Pinecone.describeIndexRaw", e);
      return {
        database: {},
        status: {
          ready: false,
          host: null,
        },
      };
    }
  }

  async totalIndicies() {
    const { pineconeIndex } = await this.connect();
    try {
      const stats = await pineconeIndex.describeIndexStats();
      const totalVectors = Object.values(stats.namespaces || {}).reduce(
        (a, b) => a + (b.vectorCount || 0),
        0
      );
      // Add global record count if available and namespaces are empty
      return { result: totalVectors || stats.totalRecordCount || 0, error: null };
    } catch (e) {
      return { result: 0, error: e.message };
    }
  }

  async collections() {
    return await this.namespaces();
  }

  async namespaces() {
    const { pineconeIndex } = await this.connect();
    try {
      const stats = await pineconeIndex.describeIndexStats();
      return Object.entries(stats.namespaces || {}).map(([name, values]) => ({
        name,
        count: values.vectorCount || 0,
      }));
    } catch (e) {
      console.error("Pinecone::namespaces", e);
      return [];
    }
  }

  async namespaceExists(index, namespace = null) {
    if (namespace === null) throw new Error("No namespace value provided.");
    const { pineconeIndex } = await this.connect();
    const stats = await pineconeIndex.describeIndexStats();
    return stats.namespaces && stats.namespaces.hasOwnProperty(namespace);
  }

  async namespace(name = null) {
    if (name === null) throw new Error("No namespace value provided.");
    const { pineconeIndex } = await this.connect();
    const stats = await pineconeIndex.describeIndexStats();
    const collection = stats.namespaces ? stats.namespaces[name] : null;
    
    if (!collection) return null;
    return {
      name,
      ...collection,
      count: collection.vectorCount || 0,
    };
  }

  async processDocument(
    namespace,
    documentData,
    embedderApiKey,
    dbDocument
  ) {
    try {
      const openai = new OpenAi(embedderApiKey);
      const { pageContent, id, ...metadata } = documentData;
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 20,
      });
      const textChunks = await textSplitter.splitText(pageContent);

      console.log("Chunks created from document:", textChunks.length);
      const documentVectors = [];
      const cacheInfo = [];
      const vectors = [];
      const vectorValues = await openai.embedTextChunks(textChunks);

      if (!!vectorValues && vectorValues.length > 0) {
        for (const [i, vector] of vectorValues.entries()) {
          const vectorId = v4();
          const vectorRecord = {
            id: vectorId,
            values: vector,
            metadata: { ...metadata, text: textChunks[i] },
          };

          vectors.push(vectorRecord);
          documentVectors.push({
            docId: id,
            vectorId: vectorRecord.id,
            documentId: dbDocument.id,
            workspaceId: dbDocument.workspace_id,
            organizationId: dbDocument.organization_id,
          });
          cacheInfo.push({
            vectorDbId: vectorRecord.id,
            values: vector,
            metadata: vectorRecord.metadata,
          });
        }
      } else {
        console.error("Could not use OpenAI to embed document chunk!");
        return { success: false, message: "Embedding failed" };
      }

      if (vectors.length > 0) {
        const { pineconeIndex } = await this.connect();
        const targetNamespace = pineconeIndex.namespace(namespace);
        
        for (const chunk of toChunks(vectors, 500)) {
          await targetNamespace.upsert(chunk);
        }
      }

      await DocumentVectors.createMany(documentVectors);
      await storeVectorResult(
        cacheInfo,
        WorkspaceDocument.vectorFilename(dbDocument)
      );
      return { success: true, message: null };
    } catch (e) {
      console.error("addDocumentToNamespace", e);
      return { success: false, message: e.message };
    }
  }

  async similarityResponse(namespace, queryVector, topK = 4) {
    const { pineconeIndex } = await this.connect();
    const targetNamespace = pineconeIndex.namespace(namespace);
    
    const response = await targetNamespace.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
      includeValues: false, // Optimized
    });

    const result = {
      vectorIds: [],
      contextTexts: [],
      sourceDocuments: [],
      scores: [],
    };

    (response.matches || []).forEach((match) => {
      result.vectorIds.push(match.id);
      result.contextTexts.push(match.metadata ? match.metadata.text : "");
      result.sourceDocuments.push(match);
      result.scores.push(match.score);
    });

    return result;
  }

  async getMetadata(namespace = "", vectorIds = []) {
    const { pineconeIndex } = await this.connect();
    const targetNamespace = pineconeIndex.namespace(namespace);
    
    const response = await targetNamespace.fetch(vectorIds);
    const metadatas = [];

    // Response.records is the new format in some versions, but fetch typically returns object map
    const records = response.records || response.vectors || {};

    Object.values(records).forEach((vector) => {
      metadatas.push({
        vectorId: vector.id,
        ...(vector.metadata || {}),
      });
    });

    return metadatas;
  }
}

module.exports.Pinecone = PineconeProvider;
