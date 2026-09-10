import {httpRouter} from "convex/server";
import {download, upload, uploadOptions} from "./commentImages";

const http = httpRouter();
http.route({path: "/comment-images/upload", method: "POST", handler: upload});
http.route({path: "/comment-images/upload", method: "OPTIONS", handler: uploadOptions});
http.route({path: "/comment-images/file", method: "GET", handler: download});
http.route({path: "/comment-images/file", method: "OPTIONS", handler: uploadOptions});
export default http;
