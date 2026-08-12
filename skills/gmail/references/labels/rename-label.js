// Build a single, deterministic Gmail settings callback for renaming one label.
// Call it only after a planner has confirmed a collision-free from -> to pair.
function RENAME_LABEL_PLAYWRIGHT({ from, to }) {
  if (!from || !to || from === to) throw new Error("Use distinct non-empty label paths");
  const fromLeaf = from.split("/").at(-1);
  const toLeaf = to.split("/").at(-1);
  return async (page) => {
    const hosts = page.locator("td.alT div.Zsjd8d");
    const paths = await hosts.evaluateAll((nodes) => {
      const margins = [...new Set(nodes.map((node) => Number.parseFloat(node.style.marginLeft || "0") || 0))].sort((a, b) => a - b);
      const hierarchy = [];
      return nodes.map((node) => {
        const level = Math.max(0, margins.indexOf(Number.parseFloat(node.style.marginLeft || "0") || 0));
        hierarchy.length = level;
        const leaf = node.textContent.trim();
        const path = level ? `${hierarchy[level - 1]}/${leaf}` : leaf;
        hierarchy[level] = path;
        return path;
      });
    });
    const index = paths.indexOf(from);
    if (index < 0 || paths.filter((path) => path === from).length !== 1) throw new Error(`Expected one label path '${from}'`);
    const row = hosts.nth(index).locator("xpath=ancestor::tr");
    await row.getByRole("link", { name: "edit", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Edit label" });
    await dialog.getByRole("textbox", { name: "Label name:" }).fill(toLeaf);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    // Gmail updates the settings table asynchronously. Wait for the dialog to
    // close before a caller re-dumps labels; a fixed immediate read is stale.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await dialog.count() === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (await dialog.count() !== 0) throw new Error(`Label editor did not close for '${from}'`);
    return { renamed: true, from, to };
  };
}

module.exports = { RENAME_LABEL_PLAYWRIGHT };
