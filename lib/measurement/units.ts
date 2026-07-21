import { UnitSystem } from "@/types/models";

export function feetToMeters(value: number) {
  return value * 0.3048;
}

export function metersToFeet(value: number) {
  return value / 0.3048;
}

export function squareFeetToSquareMeters(value: number) {
  return value * 0.092903;
}

export function formatLength(feet: number, unitSystem: UnitSystem, decimalFeet = false) {
  if (unitSystem === "metric") {
    return `${feetToMeters(feet).toFixed(2)} m`;
  }

  if (decimalFeet) {
    return `${feet.toFixed(2)} ft`;
  }

  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  return `${wholeFeet}' ${inches}"`;
}

export function formatArea(squareFeet: number, unitSystem: UnitSystem) {
  if (unitSystem === "metric") {
    return `${squareFeetToSquareMeters(squareFeet).toFixed(2)} m²`;
  }
  return `${squareFeet.toFixed(1)} sq ft`;
}
