import test from "node:test";
import assert from "node:assert/strict";
import { nearestPetEdge, dockPet, floatingPet, constrainPet, validPetEdge, PET_SIZE } from "../../dist/desktop/pet-layout.js";
const area = { x: 0, y: 25, width: 1440, height: 850 };
test("edge docking uses left, right and usable top; bottom stays free", () => {
  assert.equal(nearestPetEdge({ x: 20, y: 400 }, area), "left");
  assert.equal(nearestPetEdge({ x: 1430, y: 400 }, area), "right");
  assert.equal(nearestPetEdge({ x: 700, y: 30 }, area), "top");
  assert.equal(nearestPetEdge({ x: 700, y: 0 }, area), "top", "Dragging into menu bar still docks below it");
  assert.equal(nearestPetEdge({ x: 0, y: 400 }, { ...area, x: 80, width: 1360 }), "left", "Side Dock does not prevent edge docking");
  assert.equal(nearestPetEdge({ x: 700, y: 875 }, area), null);
  assert.equal(nearestPetEdge({ x: 25, y: 400 }, area), null);
  assert.equal(nearestPetEdge({ x: 20, y: 27 }, area), "top");
});
test("compact bounds stay inside the selected display, including negative coordinates and corners", () => {
  for (const display of [area, { x: -1920, y: -900, width: 1920, height: 1080 }]) {
    for (const edge of ["left", "right", "top"] as const) {
      for (const point of [{ x: display.x, y: display.y }, { x: display.x + display.width, y: display.y + display.height }]) {
        const b = dockPet(edge, point, display);
        assert.ok(b.x >= display.x && b.y >= display.y);
        assert.ok(b.x + b.width <= display.x + display.width);
        assert.ok(b.y + b.height <= display.y + display.height);
        assert.equal(b.width * b.height, 68 * 32);
        if (edge === "left") assert.equal(b.x, display.x);
        if (edge === "right") assert.equal(b.x + b.width, display.x + display.width);
        if (edge === "top") assert.equal(b.y, display.y);
      }
    }
  }
});
test("detaching restores the normal character around the pointer, old preferences remain free", () => {
  const bounds = floatingPet({ x: 600, y: 400 });
  assert.deepEqual(bounds, { x: 369, y: 202, ...PET_SIZE });
  assert.deepEqual(constrainPet({ ...bounds, x: -10000, y: -10000 }, area), { x: 0, y: 25, ...PET_SIZE });
  assert.equal(validPetEdge(undefined), null);
  assert.equal(validPetEdge("bottom"), null);
  assert.equal(validPetEdge("top"), "top");
});
