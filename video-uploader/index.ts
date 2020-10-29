import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import Busboy from "busboy";
import { v4 } from "uuid";
import jwt from "jsonwebtoken";
import { Readable } from "stream";

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

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
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
      if (p) {
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
        console.log("busboy did not find file :(");
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
