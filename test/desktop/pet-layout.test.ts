import test from "node:test";
import assert from "node:assert/strict";
import { nearestPetEdge, dockPet, floatingPet, constrainPet, validPetEdge, placeFloatingPet, bottomPetDock, petMovementArea, PET_SIZE } from "../../dist/desktop/pet-layout.js";
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
  assert.equal(validPetEdge("bottom"), "bottom");
  assert.equal(validPetEdge("top"), "top");
});

test("visible pet reaches the upper and left areas without transparent-window margins snapping it back", () => {
  for (const desired of [{ x: 80, y: 80 }, { x: 45, y: 180 }, { x: 700, y: 70 }]) {
    const layout = placeFloatingPet(desired, area);
    assert.equal(layout.bounds.x + layout.body.x + 39, desired.x);
    assert.equal(layout.bounds.y + layout.body.y + 35.25, desired.y);
    assert.deepEqual(placeFloatingPet(layout.center, area), layout, "Release/recovery is stable");
  }
});
test("bottom docking accepts the blank sides, keeps the Dock center clear and supports negative displays", () => {
  for (const display of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1600, y: 0, width: 1600, height: 900 }]) {
    for (const x of [display.x + 80, display.x + display.width - 80]) {
      const dock = bottomPetDock({ x, y: display.height - 1 }, display, 1000);
      assert.ok(dock);
      assert.equal(dock.y + dock.height, display.height);
      assert.equal(dock.width, 68);
    }
    assert.equal(bottomPetDock({ x: display.x + display.width / 2, y: display.height - 1 }, display, 1000), null);
  }
});

test("dragging through Dock side lanes follows the pointer down to the physical bottom", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const workArea = { x: 0, y: 25, width: 1920, height: 981 };
  for (const x of [80, 1840]) {
    for (let y = 960; y <= 1040; y += 5) {
      const center = { x, y };
      const area = petMovementArea(center, display, workArea, 1000);
      assert.equal(placeFloatingPet(center, area).center.y, y);
    }
  }
  const center = { x: 960, y: 1040 };
  assert.deepEqual(petMovementArea(center, display, workArea, 1000), workArea, "The central Dock remains protected");
});
