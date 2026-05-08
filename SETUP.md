# Diskas – Setup Guide

## 1. Install MySQL
Download and install MySQL from https://dev.mysql.com/downloads/installer/

## 2. Create the Database
Open MySQL Workbench or mysql CLI and run:
```sql
SOURCE config/schema.sql;
```
Or paste the contents of `config/schema.sql` into your MySQL client.

## 3. Configure Environment
Edit `.env` with your MySQL credentials:
```
DB_USER=root
DB_PASSWORD=your_actual_mysql_password
ADMIN_EMAIL=admin@diskas.com
ADMIN_PASSWORD=Admin@123
```

## 4. Install & Run
```bash
npm install         # already done
npm run dev         # development (auto-restart)
npm start           # production
```

## 5. Open in Browser
- **Site:**  http://localhost:3000
- **Admin:** http://localhost:3000/admin
- **Login:** admin@diskas.com / Admin@123

## Project Structure
```
Diskas/
├── config/
│   ├── database.js       MySQL pool connection
│   └── schema.sql        Database schema + seed data
├── controllers/          Route handlers
│   ├── authController    Register, login, profile
│   ├── homeController    Homepage, search
│   ├── postController    Discussions, Q&A, votes
│   ├── jobController     Job board
│   ├── skillController   Skills/courses
│   └── adminController   Admin dashboard
├── middleware/auth.js    Auth guards, flash locals
├── helpers/
│   ├── db.js             SQL query helpers
│   └── utils.js          Slug, pagination, time
├── routes/               Express routers
├── views/
│   ├── layouts/main.ejs  Public site layout
│   ├── admin/layout.ejs  Admin layout
│   ├── auth/             Login, register, profile
│   ├── posts/            Discussions
│   ├── jobs/             Job board
│   ├── skills/           Skills
│   └── admin/            Admin pages
├── public/
│   ├── css/style.css     Main styles
│   ├── css/admin.css     Admin styles
│   └── js/main.js        Frontend JS
└── server.js             App entry point
```

## Key Features
- **User system**: Register, login, profile with avatar upload
- **Discussions**: Create posts, Q&A, announcements, voting, comments
- **Job Board**: Post & browse jobs with filters (type, category, location)
- **Skills**: Share & learn skills with levels, videos, resources
- **Admin Dashboard**:
  - Overview stats (users, posts, jobs, skills)
  - User management (role, status, ban/suspend)
  - Content moderation (approve/reject/pin/close)
  - Job & skill approval workflow
  - Reports management
  - Site settings
  - Category management
- **Search** across all content types
- **Roles**: user, moderator, admin
