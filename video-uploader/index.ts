import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import Busboy from "busboy";
import { v4 } from "uuid";
import jwt from "jsonwebtoken";
import { Readable } from "stream";
import nsfwjs from 'nsfwjs';


const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!
);
const containerClient = blobServiceClient.getContainerClient("main");

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

  let finallyPred = 0;
  busboy.on("file", async(fieldname, file, filename, encoding, mimetype) => {
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
      onFrame: console.log
    });
    let prediction: number[] = [];
    predictions.map((value) => {
      prediction.push(value[0].probability);
    });
    prediction.map((value) => {
      if(finallyPred < value) finallyPred = value;
    });
    console.log("start upload");
    p = blockBlobClient.uploadStream(
      new Readable().wrap(file),
      undefined,
      undefined,
      {
        blobHTTPHeaders: { blobContentType: "image/gif" },
      }
    );
  });
  const done = new Promise((res) =>
    busboy.on("finish", async () => {
      if (p && finallyPred <= 10) {
        await p;
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
