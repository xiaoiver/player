export async function URLFromFiles(files: string[]) {
  const texts = await Promise.all(
    files.map((file) => fetch(file).then((response) => response.text()))
  );

  const text = texts.join("");
  const blob = new Blob([text], { type: "application/javascript" });

  return URL.createObjectURL(blob);
}
