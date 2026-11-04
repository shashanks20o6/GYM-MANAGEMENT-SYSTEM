-- Platform subscription feature for Gym Owners.
-- Safe to run against an existing gym_db: it only creates two new tables.
USE gym_db;

CREATE TABLE IF NOT EXISTS platform_subscription_plans (
  platform_plan_id INT AUTO_INCREMENT PRIMARY KEY,
  plan_name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  duration_months INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_platform_plans_created_by
    FOREIGN KEY (created_by) REFERENCES users(user_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_platform_plan_duration CHECK (duration_months > 0),
  CONSTRAINT chk_platform_plan_price CHECK (price > 0),
  INDEX idx_platform_plans_active (is_active, price)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gym_owner_subscriptions (
  owner_subscription_id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL,
  platform_plan_id INT NOT NULL,
  plan_name_snapshot VARCHAR(100) NOT NULL,
  duration_months_snapshot INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payment_status ENUM('Pending', 'Paid', 'Failed', 'Refunded') NOT NULL DEFAULT 'Pending',
  payment_method ENUM('UPI', 'Card', 'NetBanking', 'Bank Transfer', 'Cash') NOT NULL,
  transaction_reference VARCHAR(100) NOT NULL UNIQUE,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_owner_subscriptions_gym
    FOREIGN KEY (gym_id) REFERENCES gyms(gym_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_owner_subscriptions_plan
    FOREIGN KEY (platform_plan_id) REFERENCES platform_subscription_plans(platform_plan_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_owner_subscription_duration CHECK (duration_months_snapshot > 0),
  CONSTRAINT chk_owner_subscription_amount CHECK (amount > 0),
  CONSTRAINT chk_owner_subscription_dates CHECK (end_date >= start_date),
  INDEX idx_owner_subscriptions_gym_dates (gym_id, start_date, end_date),
  INDEX idx_owner_subscriptions_payment_date (payment_status, paid_at)
) ENGINE=InnoDB;
