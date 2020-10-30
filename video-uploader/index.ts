import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { BlobServiceClient, BlockBlobClient } from "@azure/storage-blob";
import Busboy from "busboy";
import { v4 } from "uuid";
import jwt from "jsonwebtoken";
import nsfwjs from "nsfwjs";

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
  const nsfwProvider = await nsfwjs.load();
  const predictions = await nsfwProvider.classifyGif(buf, {
    topk: 1,
    fps: 1,
    onFrame: console.log,
  });
  predictions.forEach((value) => {
    if (value[0].probability > 0.1) {
      console.log("prob: ", value[0].probability);
      throw new Error("nsfw detected");
    }
  });
  console.log("start upload");
  await blockBlobClient.upload(buf, buf.length, {
    blobHTTPHeaders: { blobContentType: "image/gif" },
  });
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

  let p: Promise<any>;

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    p = doAsyncStuff(blockBlobClient, file);
  });
  const done = new Promise((res) =>
    busboy.on("finish", async () => {
      if (p) {
        try {
          await p;
        } catch (err) {
          console.log(err);
          console.log("busboy did not find file :( / was nsfw");
          res({
            status: 400,
            body: "nsfw content detected and blocked",
          });
        }
        console.log("busboy finish :)");
        res({
          status: 200,
          body: { token: jwt.sign({ filename }, process.env.TOKEN_SECRET!) },
          headers: {
            "Content-Type": "application/json",
          },
        });
      } else {
        console.log("busboy did not find file :( / was nsfw");
        res({
          status: 400,
        });
      }
    })
  );

  busboy.write(req.body, function () {});

  const value = await done;
  return value;
};

export default httpTrigger;
