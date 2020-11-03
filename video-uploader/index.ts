import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { BlobServiceClient, BlockBlobClient } from "@azure/storage-blob";
import Busboy from "busboy";
import { v4 } from "uuid";
import jwt from "jsonwebtoken";
import { ApiKeyCredentials } from "@azure/ms-rest-js";
import { ComputerVisionClient } from "@azure/cognitiveservices-computervision";

const computerVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({
    inHeader: { "Ocp-Apim-Subscription-Key": process.env.AZURE_VISION_KEY },
  }),
  process.env.AZURE_VISION_ENDPOINT!
);

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!
);
const containerClient = blobServiceClient.getContainerClient("main");

const doAsyncStuff = async (
  blockBlobClient: BlockBlobClient,
  file: NodeJS.ReadableStream
) => {
  const buf = await new Promise<Buffer>((res) => {
    const bufs: any[] = [];
    file.on("data", function (d) {
      bufs.push(d);
    });
    file.on("end", () => {
      res(Buffer.concat(bufs));
    });
  });
  const q = await computerVisionClient.analyzeImageInStream(buf, {
    visualFeatures: ["Adult"],
  });

  await blockBlobClient.upload(buf, buf.length, {
    blobHTTPHeaders: { blobContentType: "image/gif" },
  });

  if (q.adult?.isAdultContent) {
    return "adult";
  }

  if (q.adult?.isRacyContent) {
    return "racy";
  }

  if (q.adult?.goreScore) {
    return "gore";
  }

  return null;
};

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<any> {
  console.log("got req");
  const busboy = new Busboy({
    headers: req.headers,
    limits: {
      fields: 0,
      files: 1,
      fileSize: 20000000, // 20mb
    },
  });
  const filename = v4() + ".gif";
  const blockBlobClient = containerClient.getBlockBlobClient(filename);

  let p: Promise<any> | null = null;

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    p = doAsyncStuff(blockBlobClient, file);
  });

  const done = new Promise((res) =>
    busboy.on("finish", () => {
      res();
    })
  );

  busboy.write(req.body, function () {});

  await done;
  if (p) {
    const flagged = await p;
    console.log("busboy finish :)");
    return {
      status: 200,
      body: {
        token: jwt.sign({ filename, flagged }, process.env.TOKEN_SECRET!, {
          expiresIn: "1m",
        }),
      },
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  console.log("busboy did not find file");
  return {
    status: 400,
    body: "invalid payload",
  };
};

export default httpTrigger;
