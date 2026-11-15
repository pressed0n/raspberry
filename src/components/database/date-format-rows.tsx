"use client";
/* The six ways a date column can read, and the two clocks — written once.
   ---------------------------------------------------------------------------
   These rows were written inside the property menu's `Date format` submenu. They are also the
   body of the fly-out the date picker opens beside itself, because the format is a *reading of
   the value in front of you*: the owner asked for the picker to carry it rather than making
   someone close the cell, find the column header and come back.

   So the list is here, and both surfaces import it. The failure this prevents is not
   hypothetical — it is the one that already shipped once in this menu: two surfaces that
   describe the same thing, where one of them grows a sixth row and the other stays at five.
   `tests/database-dates.test.ts` fails if either file stops importing this one.

   Neither surface says here *what picking does beyond the write*. The header closes its whole
   menu; the picker's fly-out stays open where it is, because the person is mid-edit on a row
   and neither a format change nor a clock change may take their day with it.
*/
import { dateFormatChoices, timeFormatChoices } from "@/lib/database/properties";
import { clockText } from "@/lib/database/property-types/date";
import type { DateFormatName } from "@/lib/database/types";
import { MenuDivider, MenuHeading, MenuItem } from "./menu";

export function DateFormatRows({ format, onPick }: { format: string; onPick: (format: DateFormatName) => void }) {
  return (
    <>
      {dateFormatChoices.map((choice) => (
        <MenuItem
          key={choice.format}
          label={choice.label}
          check={format === choice.format}
          onSelect={() => onPick(choice.format)}
        />
      ))}
    </>
  );
}

/**
 * The clocks, under the format they belong to.
 *
 * They sit *inside* the same list rather than a surface deeper: a third surface beside a
 * 200px fly-out beside a 252px picker has nowhere to go on a phone. Rendered only when the
 * column shows times, because a format nobody can see is a preference that does nothing.
 */
export function TimeFormatRows({ clock, onPick }: { clock: "12" | "24"; onPick: (clock: "12" | "24") => void }) {
  return (
    <>
      <MenuDivider />
      <MenuHeading>Time format</MenuHeading>
      {timeFormatChoices.map((choice) => (
        <MenuItem
          key={choice.clock}
          label={choice.label}
          trailing={clockText("14:30", { includeTime: true, timeFormat: choice.clock })}
          check={clock === choice.clock}
          onSelect={() => onPick(choice.clock)}
        />
      ))}
    </>
  );
}
