variable "aws_region" {
  type        = string
  default     = "ap-south-1"
  description = "AWS region for provisioning HMS infrastructure (ap-south-1 Mumbai)"
}

variable "instance_type" {
  type        = string
  default     = "t3.small"
  description = "AWS EC2 instance type (t3.small provides 2GB RAM for seamless Docker builds)"
}

variable "project_name" {
  type        = string
  default     = "hms-hospital-management-system"
  description = "Project name tag for AWS resources"
}

variable "github_repo" {
  type        = string
  default     = "https://github.com/kaliadhairya/HMS_1.git"
  description = "Git repository URL to clone and deploy onto the EC2 instance"
}
