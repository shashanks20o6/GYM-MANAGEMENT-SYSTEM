-- Gym Owner paid-at-registration approval/refund workflow and trainer monthly payroll.
-- Run once AFTER 001_platform_subscriptions.sql against the existing gym_db.
USE gym_db;

ALTER TABLE gym_owner_subscriptions
  ADD COLUMN owner_review_status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Approved' AFTER payment_status,
  ADD COLUMN refund_status ENUM('NotApplicable', 'Available', 'Refunded') NOT NULL DEFAULT 'NotApplicable' AFTER owner_review_status,
  ADD COLUMN refund_reference VARCHAR(100) NULL AFTER paid_at,
  ADD COLUMN refunded_at DATETIME NULL AFTER refund_reference,
  ADD INDEX idx_owner_subscriptions_review_refund (owner_review_status, refund_status);

CREATE TABLE IF NOT EXISTS trainer_salary_payments (
  salary_payment_id INT AUTO_INCREMENT PRIMARY KEY,
  gym_id INT NOT NULL,
  train_id INT NOT NULL,
  salary_month DATE NOT NULL,
  base_salary_snapshot DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL,
  pay_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pay_method ENUM('Cash', 'UPI', 'Card', 'Bank Transfer') NOT NULL,
  payment_status ENUM('Paid', 'Failed') NOT NULL DEFAULT 'Paid',
  transaction_reference VARCHAR(100) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_salary_payments_gym
    FOREIGN KEY (gym_id) REFERENCES gyms(gym_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_salary_payments_trainer
    FOREIGN KEY (train_id) REFERENCES trainers(train_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_salary_snapshot_nonnegative CHECK (base_salary_snapshot > 0),
  CONSTRAINT chk_salary_amount_nonnegative CHECK (amount_paid > 0),
  CONSTRAINT uq_trainer_salary_month UNIQUE (train_id, salary_month),
  INDEX idx_salary_payments_gym_month (gym_id, salary_month),
  INDEX idx_salary_payments_date (pay_date)
) ENGINE=InnoDB;

-- Existing platform subscription rows are treated as already approved by the default value.
-- New Gym Owner registrations explicitly insert owner_review_status='Pending'.
