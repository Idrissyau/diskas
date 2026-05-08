-- Diskas Database Schema
CREATE DATABASE IF NOT EXISTS diskas_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE diskas_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  avatar VARCHAR(255) DEFAULT NULL,
  bio TEXT DEFAULT NULL,
  location VARCHAR(100) DEFAULT NULL,
  website VARCHAR(255) DEFAULT NULL,
  role ENUM('user','moderator','admin') DEFAULT 'user',
  status ENUM('active','suspended','banned') DEFAULT 'active',
  email_verified TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Categories table (for posts/questions/jobs/skills)
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'folder',
  type ENUM('discussion','job','skill') DEFAULT 'discussion',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Posts / Discussions table
CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT DEFAULT NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(280) NOT NULL UNIQUE,
  content LONGTEXT NOT NULL,
  type ENUM('discussion','question','announcement') DEFAULT 'discussion',
  status ENUM('active','pinned','closed','deleted') DEFAULT 'active',
  views INT DEFAULT 0,
  is_answered TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Comments / Answers
CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  parent_id INT DEFAULT NULL,
  content TEXT NOT NULL,
  is_accepted TINYINT(1) DEFAULT 0,
  status ENUM('active','deleted') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
);

-- Votes (upvotes/downvotes on posts and comments)
CREATE TABLE IF NOT EXISTS votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  target_id INT NOT NULL,
  target_type ENUM('post','comment') NOT NULL,
  vote TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_vote (user_id, target_id, target_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT DEFAULT NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(280) NOT NULL UNIQUE,
  company VARCHAR(150) NOT NULL,
  company_logo VARCHAR(255) DEFAULT NULL,
  location VARCHAR(150) NOT NULL,
  type ENUM('full-time','part-time','contract','remote','internship') DEFAULT 'full-time',
  salary_min INT DEFAULT NULL,
  salary_max INT DEFAULT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  description LONGTEXT NOT NULL,
  requirements LONGTEXT DEFAULT NULL,
  benefits LONGTEXT DEFAULT NULL,
  apply_url VARCHAR(500) DEFAULT NULL,
  apply_email VARCHAR(150) DEFAULT NULL,
  status ENUM('active','closed','draft','pending') DEFAULT 'pending',
  featured TINYINT(1) DEFAULT 0,
  expires_at DATE DEFAULT NULL,
  views INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Skills / Courses table
CREATE TABLE IF NOT EXISTS skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT DEFAULT NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(280) NOT NULL UNIQUE,
  description LONGTEXT NOT NULL,
  level ENUM('beginner','intermediate','advanced') DEFAULT 'beginner',
  thumbnail VARCHAR(255) DEFAULT NULL,
  video_url VARCHAR(500) DEFAULT NULL,
  resources LONGTEXT DEFAULT NULL,
  tags VARCHAR(500) DEFAULT NULL,
  status ENUM('active','draft','pending') DEFAULT 'pending',
  views INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  slug VARCHAR(90) NOT NULL UNIQUE,
  count INT DEFAULT 0
);

-- Post Tags
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  from_user_id INT DEFAULT NULL,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  link VARCHAR(500) DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  target_id INT NOT NULL,
  target_type ENUM('post','comment','user','job','skill') NOT NULL,
  reason VARCHAR(255) NOT NULL,
  details TEXT DEFAULT NULL,
  status ENUM('pending','reviewed','resolved','dismissed') DEFAULT 'pending',
  reviewed_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Saved / Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  target_id INT NOT NULL,
  target_type ENUM('post','job','skill') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_bookmark (user_id, target_id, target_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Site settings
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ───────────────────────────────────────────
-- Seed: default categories
-- ───────────────────────────────────────────
INSERT IGNORE INTO categories (name, slug, description, color, icon, type) VALUES
  ('General Discussion', 'general-discussion', 'Talk about anything', '#6366f1', 'chat', 'discussion'),
  ('Career Advice', 'career-advice', 'Get guidance on your career path', '#8b5cf6', 'briefcase', 'discussion'),
  ('Technology', 'technology', 'Tech news, tools, and trends', '#3b82f6', 'cpu', 'discussion'),
  ('Business', 'business', 'Entrepreneurship and business topics', '#10b981', 'trending-up', 'discussion'),
  ('Creative Arts', 'creative-arts', 'Design, writing, and creativity', '#f59e0b', 'pen-tool', 'discussion'),
  ('Health & Wellness', 'health-wellness', 'Health tips and wellness discussions', '#ef4444', 'heart', 'discussion'),
  ('Software & IT', 'software-it', 'Software development and IT jobs', '#6366f1', 'code', 'job'),
  ('Marketing', 'marketing', 'Marketing and growth jobs', '#ec4899', 'bar-chart-2', 'job'),
  ('Design & Creative', 'design-creative', 'Design and creative jobs', '#f59e0b', 'layers', 'job'),
  ('Finance', 'finance', 'Finance and accounting jobs', '#10b981', 'dollar-sign', 'job'),
  ('Web Development', 'web-development', 'HTML, CSS, JavaScript and frameworks', '#3b82f6', 'globe', 'skill'),
  ('Data Science', 'data-science', 'Data analysis, ML, and AI', '#8b5cf6', 'bar-chart', 'skill'),
  ('Digital Marketing', 'digital-marketing', 'SEO, social media, and ads', '#ec4899', 'megaphone', 'skill'),
  ('Graphic Design', 'graphic-design', 'Design tools and principles', '#f59e0b', 'image', 'skill');

-- Seed: default settings
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
  ('site_name', 'Diskas'),
  ('site_tagline', 'Connect. Learn. Grow.'),
  ('maintenance_mode', '0'),
  ('allow_registration', '1'),
  ('require_email_verification', '0'),
  ('job_moderation', '1'),
  ('skill_moderation', '1'),
  ('posts_per_page', '15');
