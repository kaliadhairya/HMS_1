terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# 1. Security Group: Inbound access for SSH, Frontend (4999), Backend (5001), HTTP (80)
resource "aws_security_group" "hms_sg" {
  name        = "${var.project_name}-sg"
  description = "Security group for Hospital Management System EC2 host"

  ingress {
    description = "SSH Access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HMS Web Application Frontend"
    from_port   = 4999
    to_port     = 4999
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HMS Backend API"
    from_port   = 5001
    to_port     = 5001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Standard HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Standard HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-sg"
    Project = var.project_name
  }
}

# 2. Lookup the latest official Ubuntu 24.04 LTS AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  owners = ["099720109477"] # Canonical
}

# 3. Provision the EC2 Instance with Cloud-Init Bootstrapping
resource "aws_instance" "hms_server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  vpc_security_group_ids      = [aws_security_group.hms_sg.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data = <<-EOF
              #!/bin/bash
              set -e
              exec > >(tee /var/log/hms-bootstrap.log|logger -t user-data -s 2>/dev/console) 2>&1

              echo "==> [HMS] Starting automated server bootstrap..."

              # Enable 2GB swapfile to prevent OOM during Docker container builds on t2.micro
              if [ ! -f /swapfile ]; then
                echo "==> [HMS] Configuring 2GB swap space..."
                fallocate -l 2G /swapfile
                chmod 600 /swapfile
                mkswap /swapfile
                swapon /swapfile
                echo '/swapfile none swap sw 0 0' >> /etc/fstab
              fi

              # Install Docker, Docker Compose, Git, and network utilities
              echo "==> [HMS] Installing packages..."
              apt-get update -y
              apt-get install -y docker.io docker-compose-v2 git curl

              systemctl start docker
              systemctl enable docker
              usermod -aG docker ubuntu

              # Clone the HMS repository
              echo "==> [HMS] Cloning application repository..."
              mkdir -p /opt/hms
              git clone ${var.github_repo} /opt/hms

              # Launch application using production self-contained container topology
              echo "==> [HMS] Launching containers via Docker Compose..."
              cd /opt/hms
              docker compose -f docker-compose.prod.yml up -d --build

              echo "==> [HMS] Bootstrap complete! Containers running."
              EOF

  tags = {
    Name    = "${var.project_name}-instance"
    Project = var.project_name
  }
}
