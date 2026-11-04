-- Gym Management System: 12 business tables from the supplied ER diagram.
-- Run this script in MySQL Workbench or with: mysql -u USER -p < sql/schema.sql

CREATE DATABASE IF NOT EXISTS gym_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE gym_db;

CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  role ENUM('super_admin', 'Gym_owners', 'Trainers', 'Members') NOT NULL,
  account_status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gyms (
  gym_id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL UNIQUE,
  gym_name VARCHAR(50) NOT NULL,
  location VARCHAR(255) NOT NULL,
  contact_info VARCHAR(255),
  CONSTRAINT fk_gyms_owner FOREIGN KEY (owner_id) REFERENCES users(user_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS members (
  mem_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  gym_id INT NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  phone VARCHAR(12),
  email VARCHAR(255) NOT NULL,
  dob DATE,
  address VARCHAR(255),
  medical_cond VARCHAR(255),
  photo VARCHAR(255),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_members_gym FOREIGN KEY (gym_id) REFERENCES gyms(gym_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_members_gym (gym_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trainers (
  train_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  gym_id INT NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  emp_type VARCHAR(255),
  base_salary DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  exp_years INT NOT NULL DEFAULT 0,
  photo_url VARCHAR(255),
  CONSTRAINT fk_trainers_user FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_trainers_gym FOREIGN KEY (gym_id) REFERENCES gyms(gym_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_trainers_gym (gym_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS membership_plans (
  plan_id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL,
  plan_name VARCHAR(100) NOT NULL,
  plan_duration INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_membership_plans_gym FOREIGN KEY (gym_id) REFERENCES gyms(gym_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_plan_duration CHECK (plan_duration > 0),
  CONSTRAINT chk_plan_price CHECK (price >= 0),
  INDEX idx_membership_plans_gym (gym_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS member_subscriptions (
  sub_id INT AUTO_INCREMENT PRIMARY KEY,
  mem_id INT NOT NULL,
  plan_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  auto_pay_status TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_subscriptions_member FOREIGN KEY (mem_id) REFERENCES members(mem_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(plan_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_subscriptions_member (mem_id),
  INDEX idx_subscriptions_plan (plan_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  mem_id INT NOT NULL,
  sub_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  pay_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pay_method ENUM('Cash', 'UPI', 'Card', 'NetBanking') NOT NULL,
  pay_status ENUM('Pending', 'Paid', 'Failed', 'Refunded') NOT NULL DEFAULT 'Pending',
  CONSTRAINT fk_payments_member FOREIGN KEY (mem_id) REFERENCES members(mem_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_payments_subscription FOREIGN KEY (sub_id) REFERENCES member_subscriptions(sub_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_payment_amount CHECK (amount >= 0),
  INDEX idx_payments_member (mem_id),
  INDEX idx_payments_date (pay_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workout_videos (
  video_id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL,
  workout_name VARCHAR(150) NOT NULL,
  target_muscle_group VARCHAR(100),
  video_url VARCHAR(255) NOT NULL,
  CONSTRAINT fk_workout_videos_gym FOREIGN KEY (gym_id) REFERENCES gyms(gym_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_workout_videos_gym (gym_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workout_requests (
  request_id INT AUTO_INCREMENT PRIMARY KEY,
  mem_id INT NOT NULL,
  train_id INT NOT NULL,
  request_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  member_notes TEXT,
  status ENUM('Pending', 'Accepted', 'Completed', 'Rejected') NOT NULL DEFAULT 'Pending',
  CONSTRAINT fk_workout_requests_member FOREIGN KEY (mem_id) REFERENCES members(mem_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_workout_requests_trainer FOREIGN KEY (train_id) REFERENCES trainers(train_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_workout_requests_trainer (train_id, status),
  INDEX idx_workout_requests_member (mem_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assigned_workout_plans (
  plan_id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL UNIQUE,
  plan_title VARCHAR(150) NOT NULL,
  assigned_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assigned_plans_request FOREIGN KEY (request_id) REFERENCES workout_requests(request_id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assigned_workout_exercises (
  plan_exercise_id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  video_id INT NOT NULL,
  workout_section VARCHAR(100) NOT NULL,
  display_order INT NOT NULL DEFAULT 1,
  sets INT NOT NULL DEFAULT 3,
  reps VARCHAR(100) NOT NULL DEFAULT '10',
  CONSTRAINT fk_assigned_exercises_plan FOREIGN KEY (plan_id) REFERENCES assigned_workout_plans(plan_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_assigned_exercises_video FOREIGN KEY (video_id) REFERENCES workout_videos(video_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_exercise_sets CHECK (sets > 0),
  INDEX idx_assigned_exercises_plan (plan_id, display_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trainer_attendance (
  trainatt_id INT AUTO_INCREMENT PRIMARY KEY,
  train_id INT NOT NULL,
  check_in TIME NOT NULL,
  check_out TIME,
  date DATE NOT NULL,
  CONSTRAINT fk_attendance_trainer FOREIGN KEY (train_id) REFERENCES trainers(train_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT uq_trainer_attendance_day UNIQUE (train_id, date),
  INDEX idx_attendance_date (date)
) ENGINE=InnoDB;
