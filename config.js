// ตั้งค่าการเชื่อมต่อ Google Sheet
// วาง Web app URL ที่ได้จากการ Deploy Apps Script (ลงท้ายด้วย /exec) ไว้ใน SCRIPT_URL
// ถ้าปล่อยว่าง เว็บจะเก็บข้อมูลไว้ในเบราว์เซอร์ของเครื่องที่เปิดเท่านั้น
window.ATTENDANCE_CONFIG = {
  SCRIPT_URL: "",

  // ใส่ให้ตรงกับ API_KEY ใน apps-script/Code.gs (ถ้าไม่ได้ตั้ง ปล่อยว่างไว้)
  KEY: "",

  // ดึงข้อมูลล่าสุดจาก Google Sheet ทุกกี่วินาที (ขั้นต่ำ 10)
  REFRESH_SECONDS: 30
};
