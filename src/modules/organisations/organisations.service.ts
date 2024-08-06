import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { OrganisationMembersResponseDto } from './dto/org-members-response.dto';
import { OrganisationRequestDto } from './dto/organisation.dto';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { OrganisationMember } from './entities/org-members.entity';
import { Organisation } from './entities/organisations.entity';
import { CreateOrganisationMapper } from './mapper/create-organisation.mapper';
import { OrganisationMemberMapper } from './mapper/org-members.mapper';
import { OrganisationMapper } from './mapper/organisation.mapper';
import { MemberRoleMapper } from './mapper/member-role.mapper';
import UserService from '../user/user.service';
import * as SYS_MSG from '../../helpers/SystemMessages';
import { CustomHttpException } from '../../helpers/custom-http-filter';

@Injectable()
export class OrganisationsService {
  constructor(
    @InjectRepository(Organisation)
    private readonly organisationRepository: Repository<Organisation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OrganisationMember)
    private readonly organisationMemberRepository: Repository<OrganisationMember>,
    private userService: UserService
  ) {}

  async getOrganisationMembers(
    orgId: string,
    page: number,
    page_size: number,
    sub: string
  ): Promise<OrganisationMembersResponseDto> {
    const skip = (page - 1) * page_size;
    const orgs = await this.organisationRepository.findOne({
      where: { id: orgId },
      relations: ['organisationMembers', 'organisationMembers.user_id'],
    });

    if (!orgs) throw new NotFoundException('No organisation found');

    let data = orgs.organisationMembers.map(member => {
      return OrganisationMemberMapper.mapToResponseFormat(member.user_id);
    });

    const isMember = data.find(member => member.id === sub);
    if (!isMember) throw new ForbiddenException('User does not have access to the organisation');

    data = data.splice(skip, skip + page_size);

    return { status_code: HttpStatus.OK, message: 'members retrieved successfully', data };
  }

  async create(createOrganisationDto: OrganisationRequestDto, userId: string) {
    const emailFound = await this.emailExists(createOrganisationDto.email);
    if (emailFound) throw new ConflictException('Organisation with this email already exists');

    const owner = await this.userRepository.findOne({
      where: { id: userId },
    });

    const mapNewOrganisation = CreateOrganisationMapper.mapToEntity(createOrganisationDto, owner);
    const newOrganisation = this.organisationRepository.create({
      ...mapNewOrganisation,
    });

    await this.organisationRepository.save(newOrganisation);

    const newMember = new OrganisationMember();
    newMember.user_id = owner;
    newMember.organisation_id = newOrganisation;
    console.log(newMember);

    await this.organisationMemberRepository.save(newMember);

    const mappedResponse = OrganisationMapper.mapToResponseFormat(newOrganisation);

    return { status: 'success', message: 'organisation created successfully', data: mappedResponse };
  }

  async deleteorganisation(id: string) {
    try {
      const org = await this.organisationRepository.findOneBy({ id });
      if (!org) {
        throw new NotFoundException(`Organisation with id: ${id} not found`);
      }
      org.isDeleted = true;
      await this.organisationRepository.save(org);
      return HttpStatus.NO_CONTENT;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(`An internal server error occurred: ${error.message}`);
    }
  }
  async emailExists(email: string): Promise<boolean> {
    const emailFound = await this.organisationRepository.findBy({ email });
    return emailFound?.length ? true : false;
  }

  async updateOrganisation(
    id: string,
    updateOrganisationDto: UpdateOrganisationDto
  ): Promise<{ message: string; org: Organisation }> {
    try {
      const org = await this.organisationRepository.findOneBy({ id });
      if (!org) {
        throw new NotFoundException('organisation not found');
      }
      await this.organisationRepository.update(id, updateOrganisationDto);
      const updatedOrg = await this.organisationRepository.findOneBy({ id });

      return { message: 'Organisation successfully updated', org: updatedOrg };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(`An internal server error occurred: ${error.message}`);
    }
  }

  async getUserOrganisations(userId: string) {
    const res = await this.userService.getUserDataWithoutPasswordById(userId);
    const user = res.user as User;

    console.log(user);

    const createdOrgs =
      user.created_organisations && user.created_organisations.map(org => OrganisationMapper.mapToResponseFormat(org));

    const ownedOrgs =
      user.owned_organisations && user.owned_organisations.map(org => OrganisationMapper.mapToResponseFormat(org));

    const memberOrgs = await this.organisationMemberRepository.find({
      where: { user_id: { id: user.id } },
      relations: ['organisation_id', 'user_id', 'role'],
    });

    const memberOrgsMapped =
      memberOrgs &&
      memberOrgs.map(org => {
        const organisation = org.organisation_id && OrganisationMapper.mapToResponseFormat(org.organisation_id);
        const role = org.role && MemberRoleMapper.mapToResponseFormat(org.role);
        return {
          organisation,
          role,
        };
      });

    if (
      (!createdOrgs && !ownedOrgs && !memberOrgsMapped) ||
      (!createdOrgs.length && !ownedOrgs.length && !memberOrgsMapped.length)
    ) {
      throw new CustomHttpException(SYS_MSG.NO_USER_ORGS, HttpStatus.BAD_REQUEST);
    }

    return {
      status_code: HttpStatus.OK,
      message: 'Organisations retrieved successfully',
      data: {
        created_organisations: createdOrgs,
        owned_organisations: ownedOrgs,
        member_organisations: memberOrgsMapped,
      },
    };
  }
}
