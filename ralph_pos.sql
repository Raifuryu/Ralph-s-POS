-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Aug 17, 2026 at 08:14 AM
-- Server version: 10.11.11-MariaDB
-- PHP Version: 8.2.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `ralph_pos`
--

-- --------------------------------------------------------

--
-- Table structure for table `categories`
--

CREATE TABLE `categories` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock` int(11) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `description` text DEFAULT NULL,
  `category_id` char(36) DEFAULT NULL,
  `low_stock_threshold` int(11) DEFAULT NULL,
  `cost` decimal(12,2) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL
) ;

-- --------------------------------------------------------

--
-- Table structure for table `product_restocks`
--

CREATE TABLE `product_restocks` (
  `id` char(36) NOT NULL,
  `product_id` char(36) DEFAULT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL,
  `cost` decimal(12,2) NOT NULL,
  `note` text DEFAULT NULL,
  `cashier_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Stand-in structure for view `product_sales_totals`
-- (See below for the actual view)
--
CREATE TABLE `product_sales_totals` (
`product_id` char(36)
,`units_sold` decimal(32,0)
);

-- --------------------------------------------------------

--
-- Table structure for table `services`
--

CREATE TABLE `services` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `cash_flow` enum('in','out') NOT NULL DEFAULT 'in',
  `default_fee` decimal(10,2) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `wallet` enum('cash','gcash','maya') DEFAULT NULL,
  `allowed_payment_accounts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '["cash"]' CHECK (json_valid(`allowed_payment_accounts`)),
  `fee_tiers` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '[]' CHECK (json_valid(`fee_tiers`)),
  `pricing_mode` enum('flat','per_unit') NOT NULL DEFAULT 'flat',
  `unit_prices` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`unit_prices`))
) ;

-- --------------------------------------------------------

--
-- Table structure for table `service_transactions`
--

CREATE TABLE `service_transactions` (
  `id` char(36) NOT NULL,
  `service_id` char(36) DEFAULT NULL,
  `service_name` varchar(255) NOT NULL,
  `cash_flow` enum('in','out') NOT NULL,
  `principal` decimal(12,2) NOT NULL,
  `fee` decimal(10,2) NOT NULL,
  `cashier_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `wallet` enum('cash','gcash','maya') DEFAULT NULL,
  `payment_account` enum('cash','gcash','maya') NOT NULL,
  `contact_number` text DEFAULT NULL,
  `reference` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `tendered` decimal(12,2) DEFAULT NULL,
  `voided_at` timestamp NULL DEFAULT NULL,
  `voided_by` char(36) DEFAULT NULL,
  `void_reason` text DEFAULT NULL,
  `unit_label` text DEFAULT NULL,
  `unit_quantity` int(11) DEFAULT NULL,
  `unit_price` decimal(12,2) DEFAULT NULL,
  `visit_id` char(36) DEFAULT NULL,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `surcharge_amount` decimal(12,2) NOT NULL DEFAULT 0.00
) ;

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` char(36) NOT NULL,
  `payment_method` enum('cash','gcash','maya') DEFAULT NULL,
  `cashier_id` char(36) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `tendered` decimal(12,2) DEFAULT NULL,
  `is_personal_take` tinyint(1) NOT NULL DEFAULT 0,
  `voided_at` timestamp NULL DEFAULT NULL,
  `voided_by` char(36) DEFAULT NULL,
  `void_reason` text DEFAULT NULL,
  `visit_id` char(36) DEFAULT NULL
) ;

-- --------------------------------------------------------

--
-- Table structure for table `transaction_items`
--

CREATE TABLE `transaction_items` (
  `id` char(36) NOT NULL,
  `transaction_id` char(36) NOT NULL,
  `product_id` char(36) DEFAULT NULL,
  `product_name` varchar(255) NOT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  `quantity` int(11) NOT NULL,
  `unit_cost` decimal(12,2) DEFAULT NULL,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `surcharge_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) GENERATED ALWAYS AS (`unit_price` * `quantity` + `surcharge_amount` - `discount_amount`) STORED
) ;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` char(36) NOT NULL,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `vault_balance`
-- (See below for the actual view)
--
CREATE TABLE `vault_balance` (
`account` varchar(5)
,`balance` decimal(12,2)
,`last_counted_at` timestamp
);

-- --------------------------------------------------------

--
-- Table structure for table `vault_entries`
--

CREATE TABLE `vault_entries` (
  `id` char(36) NOT NULL,
  `seq` bigint(20) NOT NULL,
  `entry_type` enum('sale','service','deposit','withdrawal','count','void') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `expected` decimal(12,2) DEFAULT NULL,
  `transaction_id` char(36) DEFAULT NULL,
  `service_transaction_id` char(36) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `created_by` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `account` enum('cash','gcash','maya') NOT NULL
) ;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `categories_name_key` (`name`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD KEY `products_active_name_idx` (`name`),
  ADD KEY `products_category_id_idx` (`category_id`);

--
-- Indexes for table `product_restocks`
--
ALTER TABLE `product_restocks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_restocks_cashier_id_fkey` (`cashier_id`),
  ADD KEY `product_restocks_created_at_idx` (`created_at` DESC),
  ADD KEY `product_restocks_product_id_idx` (`product_id`);

--
-- Indexes for table `services`
--
ALTER TABLE `services`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `services_name_key` (`name`);

--
-- Indexes for table `service_transactions`
--
ALTER TABLE `service_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `service_transactions_cashier_id_fkey` (`cashier_id`),
  ADD KEY `service_transactions_voided_by_fkey` (`voided_by`),
  ADD KEY `idx_service_transactions_visit_id` (`visit_id`),
  ADD KEY `service_transactions_created_at_idx` (`created_at` DESC),
  ADD KEY `service_transactions_service_id_idx` (`service_id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `transactions_voided_by_fkey` (`voided_by`),
  ADD KEY `idx_transactions_visit_id` (`visit_id`),
  ADD KEY `transactions_cashier_id_idx` (`cashier_id`),
  ADD KEY `transactions_created_at_idx` (`created_at` DESC);

--
-- Indexes for table `transaction_items`
--
ALTER TABLE `transaction_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `transaction_items_product_idx` (`product_id`),
  ADD KEY `transaction_items_txn_id_idx` (`transaction_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `users_username_key` (`username`);

--
-- Indexes for table `vault_entries`
--
ALTER TABLE `vault_entries`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `vault_entries_seq_key` (`seq`),
  ADD KEY `vault_entries_created_by_fkey` (`created_by`),
  ADD KEY `vault_entries_service_transaction_id_fkey` (`service_transaction_id`),
  ADD KEY `vault_entries_transaction_id_fkey` (`transaction_id`),
  ADD KEY `vault_entries_account_seq_idx` (`account`,`seq` DESC),
  ADD KEY `vault_entries_seq_idx` (`seq` DESC);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `vault_entries`
--
ALTER TABLE `vault_entries`
  MODIFY `seq` bigint(20) NOT NULL AUTO_INCREMENT;

-- --------------------------------------------------------

--
-- Structure for view `product_sales_totals`
--
DROP TABLE IF EXISTS `product_sales_totals`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `product_sales_totals`  AS SELECT `ti`.`product_id` AS `product_id`, sum(`ti`.`quantity`) AS `units_sold` FROM (`transaction_items` `ti` join `transactions` `t` on(`t`.`id` = `ti`.`transaction_id`)) WHERE `ti`.`product_id` is not null AND `t`.`is_personal_take` = 0 AND `t`.`voided_at` is null AND `t`.`created_at` >= current_timestamp() - interval 3 day GROUP BY `ti`.`product_id` ;

-- --------------------------------------------------------

--
-- Structure for view `vault_balance`
--
DROP TABLE IF EXISTS `vault_balance`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vault_balance`  AS SELECT `acct`.`account` AS `account`, cast(coalesce(`lc`.`amount`,0) + coalesce((select sum(`v`.`amount`) from `vault_entries` `v` where `v`.`entry_type` <> 'count' and `v`.`account` = `acct`.`account` and `v`.`seq` > coalesce(`lc`.`seq`,0)),0) as decimal(12,2)) AS `balance`, `lc`.`created_at` AS `last_counted_at` FROM ((select 'cash' AS `account` union all select 'gcash' AS `gcash` union all select 'maya' AS `maya`) `acct` left join (select `ve`.`account` AS `account`,`ve`.`amount` AS `amount`,`ve`.`seq` AS `seq`,`ve`.`created_at` AS `created_at` from `vault_entries` `ve` where `ve`.`entry_type` = 'count' and `ve`.`seq` = (select max(`ve2`.`seq`) from `vault_entries` `ve2` where `ve2`.`entry_type` = 'count' and `ve2`.`account` = `ve`.`account`)) `lc` on(`lc`.`account` = `acct`.`account`)) ;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `product_restocks`
--
ALTER TABLE `product_restocks`
  ADD CONSTRAINT `product_restocks_cashier_id_fkey` FOREIGN KEY (`cashier_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `product_restocks_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `service_transactions`
--
ALTER TABLE `service_transactions`
  ADD CONSTRAINT `service_transactions_cashier_id_fkey` FOREIGN KEY (`cashier_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `service_transactions_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `service_transactions_voided_by_fkey` FOREIGN KEY (`voided_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_cashier_id_fkey` FOREIGN KEY (`cashier_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `transactions_voided_by_fkey` FOREIGN KEY (`voided_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `transaction_items`
--
ALTER TABLE `transaction_items`
  ADD CONSTRAINT `transaction_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `transaction_items_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `vault_entries`
--
ALTER TABLE `vault_entries`
  ADD CONSTRAINT `vault_entries_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `vault_entries_service_transaction_id_fkey` FOREIGN KEY (`service_transaction_id`) REFERENCES `service_transactions` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `vault_entries_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
