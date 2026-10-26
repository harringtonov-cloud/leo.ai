import type { Attachment } from "@/lib/types";

export const MAX_ATTACHMENTS = 6;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|sql|yml|yaml|toml|ini|env\.example|log|tex|r|swift)$/i;

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** Downscale large photos so the request stays small; JPEG at ~1600px is plenty for vision models. */
async function compressImage(file: File): Promise<string> {
  const original = await readAsDataURL(file);
  if (file.type === "image/gif" || file.size < 350_000) return original;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not decode the image."));
    image.src = original;
  });

  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return original;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function docxToText(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("This does not look like a valid .docx file.");
  const xml = await entry.async("string");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Turns a user-selected file into an attachment the API understands, or throws a readable error. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const name = file.name;

  if (/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
    if (file.size > 12 * 1024 * 1024) throw new Error(`${name}: image is larger than 12 MB.`);
    const data = await compressImage(file);
    if (data.length > 1_900_000) throw new Error(`${name}: image is still too large after compression.`);
    return { kind: "image", name, mime: data.slice(5, data.indexOf(";")), data };
  }

  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > 2_200_000) throw new Error(`${name}: PDF must be under 2 MB.`);
    const data = await readAsDataURL(file);
    return { kind: "pdf", name, mime: "application/pdf", data: data.replace(/^data:[^;]*;/, "data:application/pdf;") };
  }

  if (/\.docx$/i.test(name)) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${name}: file is larger than 8 MB.`);
    const text = await docxToText(file);
    if (!text) throw new Error(`${name}: no text found.`);
    return { kind: "text", name, mime: "text/plain", data: text.slice(0, 70_000) };
  }

  if (file.type.startsWith("text/") || TEXT_EXT.test(name)) {
    if (file.size > 2 * 1024 * 1024) throw new Error(`${name}: text file is larger than 2 MB.`);
    return { kind: "text", name, mime: "text/plain", data: (await file.text()).slice(0, 70_000) };
  }

  throw new Error(`${name}: unsupported type. Use images, PDF, DOCX or text/code files.`);
}
