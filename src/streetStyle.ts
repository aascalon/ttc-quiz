import type { StyleSpecification } from "maplibre-gl";

/**
 * The style's layers minus transit tracks (class "transit" in the OpenMapTiles schema;
 * mainline rail like GO is class "rail" and stays), and minus labels unless wanted.
 */
export function streetMapLayers(style: StyleSpecification, { labels }: { labels: boolean }): StyleSpecification["layers"] {
  return style.layers.filter((l) => !l.id.startsWith("railway_transit") && (labels || l.type !== "symbol"));
}
