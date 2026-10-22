export function validInstituteSlot(start: string, end: string): boolean {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  return time.test(start) && time.test(end) && start >= '08:00' && end <= '21:00' && end > start;
}

export function formatInstituteSlot(start: string, end: string): string {
  const format = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
  };
  return `${format(start)} – ${format(end)}`;
}

export function addMonthsClamped(base: Date, months: number): Date {
  const first = new Date(base.getFullYear(), base.getMonth() + months, 1, base.getHours(), base.getMinutes(), base.getSeconds());
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(base.getDate(), lastDay));
  return first;
}
