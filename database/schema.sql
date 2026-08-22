-- Schema Dump for SALON PRO
-- Database: u566429295_salon_v2
-- Date: 2026-08-22T01:40:13.594Z

-- --------------------------------------------------------
-- Table structure for table `attendance`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `attendance`;
CREATE TABLE `attendance` (
  `id` varchar(50) NOT NULL,
  `employee_id` varchar(50) NOT NULL,
  `timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `type` enum('Check-In','Check-Out','Ausencia') NOT NULL,
  `photo` mediumtext,
  `geolocation` varchar(100) DEFAULT NULL,
  `device_info` varchar(255) DEFAULT NULL,
  `status` varchar(30) DEFAULT 'Normal',
  `lateness_minutes` int DEFAULT '0',
  `extra_minutes` int DEFAULT '0',
  `modified_by` varchar(100) DEFAULT NULL,
  `modified_at` timestamp NULL DEFAULT NULL,
  `is_manual` tinyint DEFAULT '0',
  `modification_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `employee_id` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `billing_codes`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `billing_codes`;
CREATE TABLE `billing_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `contract_id` varchar(50) DEFAULT NULL,
  `code` varchar(6) DEFAULT NULL,
  `action_type` enum('cancellation','manual_billing') DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL DEFAULT NULL,
  `is_used` tinyint DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `clients`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `clients`;
CREATE TABLE `clients` (
  `id` varchar(50) NOT NULL,
  `cedula` varchar(20) DEFAULT NULL,
  `nombre` varchar(255) DEFAULT NULL,
  `telefono` varchar(50) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role_id` int DEFAULT '2',
  `tipo` varchar(50) DEFAULT 'client',
  `must_change_password` tinyint(1) DEFAULT '1',
  `frecuencia` varchar(50) DEFAULT NULL,
  `salon_id` int DEFAULT '1',
  `calle` varchar(255) DEFAULT NULL,
  `numero` varchar(50) DEFAULT NULL,
  `sector` varchar(255) DEFAULT NULL,
  `ciudad` varchar(255) DEFAULT NULL,
  `status` varchar(50) DEFAULT 'Activo',
  `cardnet_customer_id` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_nacimiento` date DEFAULT NULL,
  `registration_source` varchar(50) DEFAULT 'Self',
  `last_birthday_sent_year` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `cedula` (`cedula`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `contracts`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `contracts`;
CREATE TABLE `contracts` (
  `id` varchar(50) NOT NULL,
  `client_id` varchar(50) NOT NULL,
  `plan_id` varchar(50) DEFAULT NULL,
  `signed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `signature_hash` longtext,
  `status` varchar(50) DEFAULT 'Activo',
  `last_billed_date` datetime DEFAULT NULL,
  `next_billing_date` datetime DEFAULT NULL,
  `next_retry_date` datetime DEFAULT NULL,
  `retry_count` int DEFAULT '0',
  `card_token` varchar(255) DEFAULT NULL,
  `cardnet_profile_id` varchar(50) DEFAULT NULL,
  `contract_services` text,
  `contract_price` decimal(10,2) DEFAULT NULL,
  `contract_promo_services` text,
  `contract_promo_duration` int DEFAULT '0',
  `payment_profile_id` varchar(100) DEFAULT NULL,
  `auto_billing_enabled` tinyint DEFAULT '1',
  `last_annual_fee_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `document_photo` longtext,
  `selfie_photo` longtext,
  `ip_address` varchar(50) DEFAULT NULL,
  `device_agent` text,
  `geolocation` varchar(255) DEFAULT NULL,
  `salon_id` int DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `email_logs`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `email_logs`;
CREATE TABLE `email_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(50) DEFAULT NULL,
  `email_type` varchar(50) NOT NULL,
  `recipient_email` varchar(255) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `sent_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `opened` tinyint DEFAULT '0',
  `opened_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=314 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `email_settings`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `email_settings`;
CREATE TABLE `email_settings` (
  `id` int NOT NULL DEFAULT '1',
  `smtp_host` varchar(255) DEFAULT NULL,
  `smtp_port` int DEFAULT NULL,
  `smtp_user` varchar(255) DEFAULT NULL,
  `smtp_pass` varchar(255) DEFAULT NULL,
  `smtp_from` varchar(255) DEFAULT NULL,
  `smtp_secure` tinyint DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `employees`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `employees`;
CREATE TABLE `employees` (
  `id` varchar(50) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `rol` varchar(50) DEFAULT 'Estilista',
  `telefono` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `salon_id` int DEFAULT '1',
  `status` varchar(20) DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `gift_card_logs`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `gift_card_logs`;
CREATE TABLE `gift_card_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `gift_card_id` int NOT NULL,
  `amount_redeemed` decimal(10,2) NOT NULL,
  `balance_before` decimal(10,2) NOT NULL,
  `balance_after` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `gift_card_id` (`gift_card_id`),
  CONSTRAINT `gift_card_logs_ibfk_1` FOREIGN KEY (`gift_card_id`) REFERENCES `gift_cards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `gift_cards`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `gift_cards`;
CREATE TABLE `gift_cards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `balance` decimal(10,2) NOT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `recipient_name` varchar(100) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'Active',
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `marketing_settings`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `marketing_settings`;
CREATE TABLE `marketing_settings` (
  `id` int NOT NULL DEFAULT '1',
  `birthday_automation_enabled` tinyint(1) DEFAULT '1',
  `birthday_discount` int DEFAULT '15',
  `birthday_flyer_url` text,
  `birthday_email_subject` varchar(255) DEFAULT 0xC2A146656C697A2043756D706C6561C3B16F732120F09F8E89,
  `birthday_email_template` text,
  `mass_email_template` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `payments`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `id` varchar(50) NOT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `plan_id` varchar(50) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `method` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `gateway_ref` varchar(255) DEFAULT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `cardnet_raw_response` longtext,
  `salon_id` int DEFAULT NULL,
  `applied_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `pending_surveys`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `pending_surveys`;
CREATE TABLE `pending_surveys` (
  `id` varchar(50) NOT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'Pending',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `permissions`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `permissions`;
CREATE TABLE `permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `plans`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `plans`;
CREATE TABLE `plans` (
  `id` varchar(50) NOT NULL,
  `salon_id` int DEFAULT '1',
  `title` varchar(100) DEFAULT NULL,
  `description` text,
  `price` decimal(10,2) DEFAULT NULL,
  `activation_fee` decimal(10,2) DEFAULT '0.00',
  `discount` decimal(10,2) DEFAULT '0.00',
  `color` varchar(20) DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `services` json DEFAULT NULL,
  `contract_services` text,
  `promo_services` json DEFAULT NULL,
  `promo_duration_months` int DEFAULT '0',
  `status` varchar(20) DEFAULT 'Active',
  `is_recurring` tinyint DEFAULT '1',
  `billing_cycle` varchar(20) DEFAULT 'monthly',
  `usage_limits` json DEFAULT NULL,
  `contract_price` decimal(10,2) DEFAULT '0.00',
  `contract_promo_services` text,
  `contract_promo_duration` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `role_permissions`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `role_permissions`;
CREATE TABLE `role_permissions` (
  `role_id` int NOT NULL,
  `permission_id` int NOT NULL,
  PRIMARY KEY (`role_id`,`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `roles`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) DEFAULT NULL,
  `permisos` text,
  `description` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `salons`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `salons`;
CREATE TABLE `salons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `address` text,
  `phone` varchar(50) DEFAULT NULL,
  `maps_url` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `schedule_overrides`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `schedule_overrides`;
CREATE TABLE `schedule_overrides` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` varchar(50) NOT NULL,
  `date` date NOT NULL,
  `original_hora_entrada` time DEFAULT NULL,
  `original_hora_salida` time DEFAULT NULL,
  `new_hora_entrada` time NOT NULL,
  `new_hora_salida` time NOT NULL,
  `reason` varchar(255) NOT NULL,
  `created_by` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(20) DEFAULT 'Activo',
  PRIMARY KEY (`id`),
  UNIQUE KEY `emp_date_unique` (`employee_id`,`date`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `security_requests`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `security_requests`;
CREATE TABLE `security_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(50) DEFAULT NULL,
  `service_name` varchar(255) DEFAULT NULL,
  `staff_name` varchar(100) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `settings`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `staff_records`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `staff_records`;
CREATE TABLE `staff_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `cedula` varchar(20) NOT NULL,
  `contacto` varchar(50) DEFAULT NULL,
  `posicion` varchar(100) DEFAULT NULL,
  `direccion` text,
  `localidad` varchar(255) DEFAULT NULL,
  `fecha_entrada` date DEFAULT NULL,
  `fecha_salida` date DEFAULT NULL,
  `motivo_salida` text,
  `status` enum('Activo','Inactivo','Vacaciones','Licencia') DEFAULT 'Activo',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `profile_photo` mediumtext,
  `hora_entrada` time DEFAULT NULL,
  `hora_salida` time DEFAULT NULL,
  `dias_laborables` text,
  `tolerancia_minutos` int DEFAULT '15',
  `salon_id` int DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cedula` (`cedula`)
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `surveys`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `surveys`;
CREATE TABLE `surveys` (
  `id` varchar(50) NOT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `client_name` varchar(100) DEFAULT NULL,
  `salon_id` int DEFAULT NULL,
  `salon_name` varchar(100) DEFAULT NULL,
  `staff_peluquera` varchar(100) DEFAULT NULL,
  `staff_lava_pelo` varchar(100) DEFAULT NULL,
  `staff_manicurista` varchar(100) DEFAULT NULL,
  `q1` int DEFAULT NULL,
  `q2` int DEFAULT NULL,
  `q3` int DEFAULT NULL,
  `q4` int DEFAULT NULL,
  `q5` int DEFAULT NULL,
  `q6` varchar(50) DEFAULT NULL,
  `q7` varchar(50) DEFAULT NULL,
  `q8` int DEFAULT NULL,
  `q9` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `users`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` varchar(50) NOT NULL,
  `nombre` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role_id` int DEFAULT NULL,
  `salon_id` int DEFAULT NULL,
  `tipo` varchar(50) DEFAULT 'admin',
  `last_login` datetime DEFAULT NULL,
  `role` varchar(50) DEFAULT 'admin',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `profile_photo` mediumtext,
  `hora_entrada` time DEFAULT NULL,
  `hora_salida` time DEFAULT NULL,
  `dias_laborables` text,
  `tolerancia_minutos` int DEFAULT '15',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `verification_codes`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `verification_codes`;
CREATE TABLE `verification_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(50) DEFAULT NULL,
  `code` varchar(6) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL DEFAULT NULL,
  `is_used` tinyint DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=435 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------
-- Table structure for table `visits`
-- --------------------------------------------------------
DROP TABLE IF EXISTS `visits`;
CREATE TABLE `visits` (
  `id` varchar(50) NOT NULL,
  `client_id` varchar(50) DEFAULT NULL,
  `client_name` varchar(255) DEFAULT NULL,
  `servicios` json DEFAULT NULL,
  `empleado_peluquera` varchar(255) DEFAULT NULL,
  `empleado_lava_pelo` varchar(100) DEFAULT NULL,
  `empleado_manicurista` varchar(255) DEFAULT NULL,
  `proxima_fecha` date DEFAULT NULL,
  `recordatorio_auto` tinyint(1) DEFAULT '0',
  `salon_id` int DEFAULT '1',
  `visited_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

