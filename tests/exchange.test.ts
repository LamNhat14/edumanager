import {it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {readStudents} from '../src/exchange';
async function file(rows:unknown[][]){const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('HocVien');sheet.addRows(rows);return new File([await book.xlsx.writeBuffer() as ArrayBuffer],'students.xlsx');}
it('reads Unicode and preserves leading-zero phone strings',async()=>{
 const result=await readStudents(await file([['full_name','grade','admission_date','phone'],['Nguyễn Như',7,'2026-11-01','0900000000']]));expect(result.errors).toEqual([]);expect(result.rows[0].phone).toBe('0900000000');expect(result.rows[0].full_name).toBe('Nguyễn Như');
});
it('validates impossible dates, grades and duplicate rows before import',async()=>{
 const result=await readStudents(await file([['full_name','grade','admission_date'],['Test',15,'2026-02-31'],['Test',15,'2026-02-31']]));expect(result.errors.some(e=>e.includes('ngày hợp lệ'))).toBe(true);expect(result.errors.some(e=>e.includes('trùng'))).toBe(true);expect(result.errors.some(e=>e.includes('khối'))).toBe(true);
});
it('does not execute or import Excel formulas',async()=>{
 const result=await readStudents(await file([['full_name','grade','admission_date'],[{formula:'1+1'},7,'2026-11-01']]));expect(result.errors.some(e=>e.includes('công thức'))).toBe(true);
});
