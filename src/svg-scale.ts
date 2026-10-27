const COMMAND = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const NUMBER = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

export function translateSvg(svg: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return svg;
  return svg.replace(/\bd="([^"]*)"/g, (_full, data: string) => 'd="' + translatePath(data, dx, dy) + '"');
}

function translatePath(data: string, dx: number, dy: number): string {
  return data.replace(COMMAND, (_full, command: string, rest: string) => {
    const numbers = rest.match(NUMBER);
    if (numbers === null || command === command.toLowerCase()) return command + rest;
    const kind = command.toLowerCase();
    if (kind === "z") return command;
    if (kind === "h") return command + numbers.map((value) => format(Number(value) + dx)).join(" ");
    if (kind === "v") return command + numbers.map((value) => format(Number(value) + dy)).join(" ");
    if (kind === "a") {
      const moved: string[] = [];
      for (let index = 0; index + 6 < numbers.length; index += 7) {
        moved.push(
          numbers[index] ?? "0",
          numbers[index + 1] ?? "0",
          numbers[index + 2] ?? "0",
          numbers[index + 3] ?? "0",
          numbers[index + 4] ?? "0",
          format(Number(numbers[index + 5]) + dx),
          format(Number(numbers[index + 6]) + dy)
        );
      }
      return command + moved.join(" ");
    }
    const moved: string[] = [];
    for (let index = 0; index < numbers.length; index += 2) {
      moved.push(format(Number(numbers[index]) + dx), format(Number(numbers[index + 1]) + dy));
    }
    return command + moved.join(" ");
  });
}

export function scaleSvg(svg: string, factor: number): string {
  if (factor === 1) return svg;
  const sized = svg
    .replace(/\b(width|height)="([0-9.]+)"/g, (_full, name: string, value: string) => name + '="' + format(Number(value) * factor) + '"')
    .replace(/viewBox="([^"]+)"/g, (_full, value: string) => 'viewBox="' + value.trim().split(/[\s,]+/).map((part) => format(Number(part) * factor)).join(" ") + '"');
  return sized.replace(/\bd="([^"]*)"/g, (_full, data: string) => 'd="' + scalePath(data, factor) + '"');
}

function scalePath(data: string, factor: number): string {
  return data.replace(COMMAND, (_full, command: string, rest: string) => {
    const numbers = rest.match(NUMBER);
    if (numbers === null) return command;
    const kind = command.toLowerCase();
    if (kind === "z") return command;
    if (kind === "a") {
      const scaled: string[] = [];
      for (let index = 0; index + 6 < numbers.length; index += 7) {
        scaled.push(
          format(Number(numbers[index]) * factor),
          format(Number(numbers[index + 1]) * factor),
          numbers[index + 2] ?? "0",
          numbers[index + 3] ?? "0",
          numbers[index + 4] ?? "0",
          format(Number(numbers[index + 5]) * factor),
          format(Number(numbers[index + 6]) * factor)
        );
      }
      return command + scaled.join(" ");
    }
    return command + numbers.map((value) => format(Number(value) * factor)).join(" ");
  });
}

function format(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}
