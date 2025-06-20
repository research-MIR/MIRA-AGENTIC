import * as React from "react"
import { addDays, format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface DateRangePickerProps extends React.HTMLAttributes<HTMLDivElement> {
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
}

export function DateRangePicker({
  className,
  date,
  setDate,
}: DateRangePickerProps) {

  const handlePresetChange = (value: string) => {
    const now = new Date();
    switch (value) {
      case "today":
        setDate({ from: new Date(now.setHours(0, 0, 0, 0)), to: new Date(now.setHours(23, 59, 59, 999)) });
        break;
      case "yesterday":
        const yesterdayStart = addDays(new Date(), -1);
        yesterdayStart.setHours(0, 0, 0, 0);
        const yesterdayEnd = addDays(new Date(), -1);
        yesterdayEnd.setHours(23, 59, 59, 999);
        setDate({ from: yesterdayStart, to: yesterdayEnd });
        break;
      case "last7":
        setDate({ from: addDays(now, -6), to: now });
        break;
      case "last30":
        setDate({ from: addDays(now, -29), to: now });
        break;
      case "this_month":
        setDate({ from: new Date(now.getFullYear(), now.getMonth(), 1), to: now });
        break;
      case "all":
        setDate(undefined);
        break;
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[260px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} -{" "}
                  {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex items-center border-b p-2">
            <Select onValueChange={handlePresetChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a preset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="last30">Last 30 days</SelectItem>
                <SelectItem value="this_month">This month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}