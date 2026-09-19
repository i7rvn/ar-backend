FROM node:20-alpine

WORKDIR /app

# نسخ ملفات التبعيات
COPY package*.json ./

# تثبيت التبعيات
RUN npm install --production

# نسخ باقي الكود
COPY . .

# فتح المنفذ
EXPOSE 3000

# تشغيل التطبيق
CMD ["node", "index.js"]
